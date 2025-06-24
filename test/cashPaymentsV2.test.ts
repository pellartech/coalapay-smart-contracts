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

  /* ───────────────────────────── constants ───────────────────────────── */
  const BASE_URI = "ipfs://test/";
  const NAME = "LastMileCashPayments";
  const SYMBOL = "LMP";

  const BUDGET = ethers.parseEther("1000");
  const FEE_BPS = 500n; // 5 %
  const DENOM = 10_000n;
  const UPFRONT_FEE = (BUDGET * FEE_BPS) / DENOM;
  const TOTAL_ESCROW = BUDGET + UPFRONT_FEE;

  const BATCH_AMOUNT = ethers.parseEther("200");
  const BATCH_FEE = (BATCH_AMOUNT * FEE_BPS) / DENOM;
  const BENEFICIARIES = 100;
  const PROJECT_KEY = "demo-key";

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", []);
    [admin, donor, organisation, processor, rando] = await ethers.getSigners();

    token = (await (
      await ethers.getContractFactory("TokenERC20")
    ).deploy()) as TokenERC20;
    await token.mint(donor.address, ethers.parseEther("6000"));

    lmp = (await (
      await ethers.getContractFactory("LastMileCashPayments")
    ).deploy(BASE_URI, NAME, SYMBOL)) as LastMileCashPayments;

    feeTo = await lmp.feeTo();
  });

  /* ─────────────────────────────────────────
   *  Deployment
   * ───────────────────────────────────────── */
  describe("Deployment", () => {
    it("sets admin role for deployer", async () => {
      expect(await lmp.hasRole(await lmp.DEFAULT_ADMIN_ROLE(), admin.address))
        .to.be.true;
    });

    it("allows baseURI mutation by admin only", async () => {
      await expect(lmp.connect(rando).setBaseURI("ipfs://hax/")).to.be.reverted;
      await lmp.connect(admin).setBaseURI("ipfs://changed/");
      await lmp.connect(admin).setBaseURI(BASE_URI); // restore
    });
  });

  /* ─────────────────────────────────────────
   *  Prefund flow
   * ───────────────────────────────────────── */
  describe("prefund flow", () => {
    let projectId: bigint;
    let batchId: bigint;

    beforeEach(async () => {
      /* 1️⃣ Admin creates the project **************************************** */
      const tx = await lmp
        .connect(admin)
        .createProject(
          organisation.address,
          await token.getAddress(),
          BUDGET,
          donor.address,
          PROJECT_KEY
        );
      const receipt = await tx.wait();
      projectId = (receipt!.logs[0] as any).args.projectId;

      /* 2️⃣ Donor approves & prefunds **************************************** */
      await token.connect(donor).approve(await lmp.getAddress(), TOTAL_ESCROW);

      const pfTx = await lmp.connect(donor).prefundProject(projectId);

      await expect(pfTx)
        .to.emit(lmp, "ProjectPrefunded")
        .withArgs(projectId, donor.address, BUDGET, UPFRONT_FEE);

      /* 3️⃣ Grant processor & create batch *********************************** */
      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);

      const btx = await lmp.connect(processor).createBatch(projectId);
      const log = (await btx.wait())!.logs[0] as any; // Explicitly cast to 'any' or appropriate type
      batchId = log.args.batchId;
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
      ).to.be.revertedWith("already prefunded");
    });

    it("processBatch moves principal to organisation & fee to feeTo", async () => {
      const orgStart = await token.balanceOf(organisation.address);
      const feeStart = await token.balanceOf(feeTo);

      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES);

      expect(await token.balanceOf(organisation.address)).to.equal(
        orgStart + BATCH_AMOUNT
      );

      expect(await token.balanceOf(feeTo)).to.equal(feeStart + BATCH_FEE);
    });

    it("completeProject refunds principal + unused fee", async () => {
      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES);

      const principalLeft = BUDGET - BATCH_AMOUNT; // 800
      const feeLeft = UPFRONT_FEE - BATCH_FEE; // 40
      const refund = principalLeft + feeLeft; // 840

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

  /* ─────────────────────────────────────────
   *  Authorise-spend (no prefund) flow
   * ───────────────────────────────────────── */
  describe("authorise-spend flow", () => {
    let projectId: bigint;
    let batchId: bigint;

    beforeEach(async () => {
      /* create project ******************************************************* */
      const tx = await lmp
        .connect(admin)
        .createProject(
          organisation.address,
          await token.getAddress(),
          BUDGET,
          donor.address,
          PROJECT_KEY
        );
      const receipt = await tx.wait();
      projectId = (receipt!.logs[0] as any).args.projectId;

      /* grant processor & batch ********************************************** */
      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);

      const btx = await lmp.connect(processor).createBatch(projectId);
      const log = (await btx.wait())!.logs[0] as any; // Explicitly cast to 'any' or appropriate type
      batchId = log.args.batchId;

      /* donor allowance covers principal + all fees ************************** */
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

      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES);

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

  /* ─────────────────────────────────────────
   *  Guards & misc
   * ───────────────────────────────────────── */
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
      /* admin creates a project so we get a valid ID */
      const tx = await lmp
        .connect(admin)
        .createProject(
          organisation.address,
          await token.getAddress(),
          BUDGET,
          donor.address,
          PROJECT_KEY
        );
      const receipt = await tx.wait();
      const projectId = (receipt!.logs[0] as any).args.projectId as bigint;

      /* random address (no role) cannot createBatch */
      await expect(lmp.connect(rando).createBatch(projectId)).to.be.reverted;

      /* grant processor role & create a batch */
      await lmp
        .connect(admin)
        .grantRole(await lmp.BATCH_PROCESSOR_ROLE(), processor.address);
      const btx = await lmp.connect(processor).createBatch(projectId);
      const batchId = ((await btx.wait())!.logs[0] as any).args
        .batchId as bigint;

      /* random address cannot process the batch */
      await expect(
        lmp.connect(rando).processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES)
      ).to.be.reverted;
    });
  });
});
