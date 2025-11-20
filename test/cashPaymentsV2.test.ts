import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers, network } from "hardhat";
import { LastMileCashPayments, TokenERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LastMileCashPayments (v2 with fees)", () => {
  let lmp: LastMileCashPayments;
  let token: TokenERC20;

  let admin: SignerWithAddress;
  let donor: SignerWithAddress;
  let organisation: SignerWithAddress;
  let processor: SignerWithAddress;
  let rando: SignerWithAddress;
  let altFeeRecipient: SignerWithAddress;
  let orgFeeRecipient1: SignerWithAddress;
  let orgFeeRecipient2: SignerWithAddress;
  let feeTo: string;

  /* ───────────────────────── constants ───────────────────────── */
  const BASE_URI = "ipfs://test/";
  const NAME = "LastMileCashPayments";
  const SYMBOL = "LMP";

  const BUDGET = ethers.parseEther("1000");
  const FEE_BPS = 500n; // 5 %
  const UPFRONT_FEE = (BUDGET * FEE_BPS) / 10_000n;
  const TOTAL_ESCROW = BUDGET + UPFRONT_FEE; // prefund or allowance

  // one batch: two households, 100 tokens each
  const RECIPIENTS = ["hh-1", "hh-2"];
  const AMOUNTS = [
    ethers.parseEther("100"),
    ethers.parseEther("100")
  ];
  const BATCH_AMOUNT = AMOUNTS[0] + AMOUNTS[1]; // 200
  const BATCH_FEE = (BATCH_AMOUNT * FEE_BPS) / 10_000n;
  const BENEFICIARIES = BigInt(RECIPIENTS.length);
  const PROJECT_KEY = "demo-key";

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", []);
    [admin, donor, organisation, processor, rando, altFeeRecipient, orgFeeRecipient1, orgFeeRecipient2] =
      await ethers.getSigners();

    token = (await (
      await ethers.getContractFactory("TokenERC20")
    ).deploy()) as TokenERC20;
    await token.mint(donor.address, ethers.parseEther("6000"));

    lmp = (await (
      await ethers.getContractFactory("LastMileCashPayments")
    ).deploy(BASE_URI, NAME, SYMBOL)) as LastMileCashPayments;

    feeTo = await lmp.feeTo();
  });

  /* ───────────────────────── Deployment ───────────────────────── */
  describe("Deployment", () => {
    it("sets admin role for deployer", async () => {
      expect(
        await lmp.hasRole(await lmp.DEFAULT_ADMIN_ROLE(), admin.address)
      ).to.be.true;
    });

    it("allows baseURI mutation by admin only", async () => {
      await expect(lmp.connect(rando).setBaseURI("ipfs://hax/")).to.be.reverted;
      await lmp.connect(admin).setBaseURI("ipfs://changed/");
      await lmp.connect(admin).setBaseURI(BASE_URI);
    });
  });

  /* ───────────────────────── Prefund flow ───────────────────────── */
  describe("prefund flow", () => {
    let projectId: bigint;
    let batchId: bigint;

    beforeEach(async () => {
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY,
        [],
        []
      );
      projectId = (((await tx.wait())!.logs[0]) as any).args.projectId;

      await token.connect(donor).approve(await lmp.getAddress(), TOTAL_ESCROW);
      await lmp.connect(donor).prefundProject(projectId);

      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);

      const btx = await lmp.connect(processor).createBatch(projectId);
      batchId = (((await btx.wait())!.logs[0]) as any).args.batchId;

      await lmp
        .connect(processor)
        .addRecipients(projectId, batchId, RECIPIENTS, AMOUNTS);
    });

    it("escrows principal + upfront fee after prefund", async () => {
      expect(await token.balanceOf(await lmp.getAddress())).to.equal(
        TOTAL_ESCROW
      );
      const p = await lmp.projects(projectId);
      expect(p.prefunded).to.be.true;
    });

    it("prevents double prefund", async () => {
      await expect(
        lmp.connect(donor).prefundProject(projectId)
      ).to.be.revertedWith("already paid");
    });

    it("processBatch moves principal to organisation & fee to feeTo", async () => {
      const orgStart = await token.balanceOf(organisation.address);
      const feeStart = await token.balanceOf(feeTo);

      await lmp.connect(processor).processBatch(projectId, batchId);

      expect(await token.balanceOf(organisation.address)).to.equal(
        orgStart + BATCH_AMOUNT
      );
      expect(await token.balanceOf(feeTo)).to.equal(feeStart + BATCH_FEE);
    });

    it("completeProject refunds principal + unused fee", async () => {
      await lmp.connect(processor).processBatch(projectId, batchId);

      const principalLeft = BUDGET - BATCH_AMOUNT;
      const feeLeft = UPFRONT_FEE - BATCH_FEE;
      const refund = principalLeft + feeLeft;

      const donorStart = await token.balanceOf(donor.address);
      await lmp.connect(donor).completeProject(projectId);

      expect(await token.balanceOf(donor.address)).to.equal(
        donorStart + refund
      );
      await expect(
        lmp.connect(processor).createBatch(projectId)
      ).to.be.revertedWith("invalid project");
    });
  });

  // removed per-project processing fee override tests (not in scope)

  /* ───────────── Organization fees at completion (prefunded) ───────────── */
  describe("organization fees distribution on completion (prefunded)", () => {
    it("distributes org fees only on completion to multiple recipients and refunds unused", async () => {
      // processing 5%, org fees 5% split as 3% + 2%
      const PROC_BPS = 500n;
      const ORG_BPS_1 = 300n;
      const ORG_BPS_2 = 200n;
      const ORG_RECIPS = [orgFeeRecipient1.address, orgFeeRecipient2.address];
      const ORG_BPS = [Number(ORG_BPS_1), Number(ORG_BPS_2)];

      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY,
        ORG_RECIPS,
        ORG_BPS
      );
      const projectId = (((await tx.wait())!.logs[0]) as any).args.projectId as bigint;

      const upfrontProc = (BUDGET * PROC_BPS) / 10_000n; // 50
      const upfrontOrg = (BUDGET * (ORG_BPS_1 + ORG_BPS_2)) / 10_000n; // 50
      const totalEscrow = BUDGET + upfrontProc + upfrontOrg; // 1100

      await token.connect(donor).approve(await lmp.getAddress(), totalEscrow);
      await lmp.connect(donor).prefundProject(projectId);

      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);
      const btx = await lmp.connect(processor).createBatch(projectId);
      const batchId = (((await btx.wait())!.logs[0]) as any).args.batchId as bigint;
      await lmp
        .connect(processor)
        .addRecipients(projectId, batchId, RECIPIENTS, AMOUNTS); // 200 paid
      await lmp.connect(processor).processBatch(projectId, batchId);

      const r1Start = await token.balanceOf(orgFeeRecipient1.address);
      const r2Start = await token.balanceOf(orgFeeRecipient2.address);
      const donorStart = await token.balanceOf(donor.address);

      await lmp.connect(donor).completeProject(projectId);

      const orgFeeTotalOnPaid = (BATCH_AMOUNT * (ORG_BPS_1 + ORG_BPS_2)) / 10_000n; // 10
      const r1Amt = (orgFeeTotalOnPaid * ORG_BPS_1) / 10_000n; // 6
      const r2Amt = orgFeeTotalOnPaid - r1Amt; // 4 (remainder to last recip in contract)

      expect(await token.balanceOf(orgFeeRecipient1.address)).to.equal(
        r1Start + r1Amt
      );
      expect(await token.balanceOf(orgFeeRecipient2.address)).to.equal(
        r2Start + r2Amt
      );

      const principalLeft = BUDGET - BATCH_AMOUNT; // 800
      const procFeeLeft = upfrontProc - (BATCH_AMOUNT * PROC_BPS) / 10_000n; // 40
      const orgFeeLeft = upfrontOrg - orgFeeTotalOnPaid; // 40
      const expectedRefund = principalLeft + procFeeLeft + orgFeeLeft; // 880
      expect(await token.balanceOf(donor.address)).to.equal(
        donorStart + expectedRefund
      );
    });
  });

  /* ───── Organization fees at completion (authorise-spend) ───── */
  describe("organization fees distribution on completion (authorise-spend)", () => {
    it("pulls org fees from donor on completion when not prefunded", async () => {
      // processing 5%, org fees 5% split as 3% + 2%
      const PROC_BPS = 500n;
      const ORG_BPS_1 = 300n;
      const ORG_BPS_2 = 200n;
      const ORG_RECIPS = [orgFeeRecipient1.address, orgFeeRecipient2.address];
      const ORG_BPS = [Number(ORG_BPS_1), Number(ORG_BPS_2)];

      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY,
        ORG_RECIPS,
        ORG_BPS
      );
      const projectId = (((await tx.wait())!.logs[0]) as any).args.projectId as bigint;

      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);
      const btx = await lmp.connect(processor).createBatch(projectId);
      const batchId = (((await btx.wait())!.logs[0]) as any).args.batchId as bigint;
      await lmp
        .connect(processor)
        .addRecipients(projectId, batchId, RECIPIENTS, AMOUNTS); // 200 paid

      // Approve enough for batch (principal + proc fee) and later completion org fee
      const batchProcFee = (BATCH_AMOUNT * PROC_BPS) / 10_000n; // 10
      const orgFeeOnPaid = (BATCH_AMOUNT * (ORG_BPS_1 + ORG_BPS_2)) / 10_000n; // 10
      const approval = BUDGET + batchProcFee + orgFeeOnPaid; // generous
      await token.connect(donor).approve(await lmp.getAddress(), approval);

      await lmp.connect(processor).processBatch(projectId, batchId);

      const r1Start = await token.balanceOf(orgFeeRecipient1.address);
      const r2Start = await token.balanceOf(orgFeeRecipient2.address);

      const completeTx = await lmp.connect(donor).completeProject(projectId);

      const r1Amt = (orgFeeOnPaid * ORG_BPS_1) / 10_000n; // 6
      const r2Amt = orgFeeOnPaid - r1Amt; // 4
      expect(await token.balanceOf(orgFeeRecipient1.address)).to.equal(
        r1Start + r1Amt
      );
      expect(await token.balanceOf(orgFeeRecipient2.address)).to.equal(
        r2Start + r2Amt
      );

      await expect(completeTx)
        .to.emit(lmp, "OrgFeesDistributed")
        .withArgs(projectId, orgFeeOnPaid, ORG_RECIPS, [r1Amt, r2Amt]);
      await expect(completeTx)
        .to.emit(lmp, "ProjectCompleted")
        .withArgs(projectId, donor.address, anyValue, anyValue, anyValue, orgFeeOnPaid);
    });
  });
  /* ─────────── Authorise-spend (no prefund) flow ─────────── */
  describe("authorise-spend flow", () => {
    let projectId: bigint;
    let batchId: bigint;

    beforeEach(async () => {
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY,
        [],
        []
      );
      projectId = (((await tx.wait())!.logs[0]) as any).args.projectId;

      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);

      const btx = await lmp.connect(processor).createBatch(projectId);
      batchId = (((await btx.wait())!.logs[0]) as any).args.batchId;

      await lmp
        .connect(processor)
        .addRecipients(projectId, batchId, RECIPIENTS, AMOUNTS);

      await token.connect(donor).approve(await lmp.getAddress(), TOTAL_ESCROW);
    });

    it("does NOT escrow tokens on creation", async () => {
      expect(await token.balanceOf(await lmp.getAddress())).to.equal(0);
      const p = await lmp.projects(projectId);
      expect(p.prefunded).to.be.false;
    });

    it("pulls principal + fee from donor per batch", async () => {
      const donorStart = await token.balanceOf(donor.address);
      const orgStart = await token.balanceOf(organisation.address);
      const feeStart = await token.balanceOf(feeTo);

      await lmp.connect(processor).processBatch(projectId, batchId);

      expect(await token.balanceOf(donor.address)).to.equal(
        donorStart - (BATCH_AMOUNT + BATCH_FEE)
      );
      expect(await token.balanceOf(organisation.address)).to.equal(
        orgStart + BATCH_AMOUNT
      );
      expect(await token.balanceOf(feeTo)).to.equal(feeStart + BATCH_FEE);
    });

    it("no refund on completion when not prefunded", async () => {
      const donorStart = await token.balanceOf(donor.address);
      await lmp.connect(donor).completeProject(projectId);
      expect(await token.balanceOf(donor.address)).to.equal(donorStart);
    });
  });

  /* ───────────────────── Guards & misc ───────────────────── */
  describe("access & input guards", () => {
    it("non-admin cannot createProject", async () => {
      await expect(
        lmp
          .connect(rando)
          .createProject(
            organisation.address,
            await token.getAddress(),
            BUDGET,
            donor.address,
            PROJECT_KEY,
            [],
            []
          )
      ).to.be.reverted;
    });

    it("processor role required for createBatch / processBatch", async () => {
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY,
        [],
        []
      );
      const projectId = (((await tx.wait())!.logs[0]) as any).args.projectId;

      await expect(lmp.connect(rando).createBatch(projectId)).to.be.reverted;

      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);

      const btx = await lmp.connect(processor).createBatch(projectId);
      const batchId = (((await btx.wait())!.logs[0]) as any).args.batchId;

      await lmp
        .connect(processor)
        .addRecipients(projectId, batchId, RECIPIENTS, AMOUNTS);

      await expect(
        lmp.connect(rando).processBatch(projectId, batchId)
      ).to.be.reverted;
    });
  });
});
