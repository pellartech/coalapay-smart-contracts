import { expect } from "chai";
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
    [admin, donor, organisation, processor, rando] =
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
        PROJECT_KEY
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
        PROJECT_KEY
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
            PROJECT_KEY
          )
      ).to.be.reverted;
    });

    it("processor role required for createBatch / processBatch", async () => {
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY
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
