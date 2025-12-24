import { expect } from "chai";
import { ethers, network } from "hardhat";
import { LastMileCashPayments, TokenERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LastMileCashPayments (V2)", function () {
  let cashV2: LastMileCashPayments;
  let token: TokenERC20;

  let admin: SignerWithAddress;
  let donor: SignerWithAddress;
  let organisation: SignerWithAddress;
  let processor: SignerWithAddress;
  let feeReceiver: SignerWithAddress;

  const NAME = "Last Mile Cash";
  const SYMBOL = "LMC";
  const BASE = "https://lmc.example/api/";

  // simple org fee config: 3% to A, 2% to B (total 5%)
  const orgFeeA = 300;
  const orgFeeB = 200;
  const processingFeeBps = 500; // 5%

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", []);
    const signers = await ethers.getSigners();
    admin = signers[0];
    donor = signers[1];
    organisation = signers[2];
    processor = signers[3];
    feeReceiver = signers[4];

    const Token = await ethers.getContractFactory("TokenERC20");
    token = (await Token.deploy()) as TokenERC20;
    await token.waitForDeployment();

    // donor gets a large balance
    await token.mint(donor.address, ethers.parseEther("1000000"));

    const CashV2 = await ethers.getContractFactory("LastMileCashPayments");
    cashV2 = (await CashV2.deploy(
      NAME,
      SYMBOL,
      BASE,
      admin.address,
      feeReceiver.address
    )) as LastMileCashPayments;
    await cashV2.waitForDeployment();

    // Configure processing fee
    await cashV2.setFeePercent(processingFeeBps);
    // Grant batch processor role
    await cashV2.grantRole(
      await cashV2.BATCH_PROCESSOR_ROLE(),
      processor.address
    );
  });

  it("deployment config stored", async () => {
    expect(await cashV2.feePercent()).to.equal(processingFeeBps);
    expect(
      await cashV2.hasRole(await cashV2.DEFAULT_ADMIN_ROLE(), admin.address)
    ).to.equal(true);
  });

  describe("Non-prefunded project flow", () => {
    let projectId: bigint;

    const budget = ethers.parseEther("1000");
    const batchAmounts = [ethers.parseEther("100"), ethers.parseEther("50")];
    const recipients = ["hh1", "hh2"];
    const projectKey = "proj-key-1";

    beforeEach(async () => {
      // Create project with org fee recipients
      await expect(
        cashV2.createProject(
          organisation.address,
          await token.getAddress(),
          budget,
          donor.address,
          projectKey,
          [organisation.address, feeReceiver.address],
          [orgFeeA, orgFeeB]
        )
      ).to.emit(cashV2, "ProjectCreated");

      projectId = (await cashV2.nextProjectId()) - 1n;

      // Donor approves contract for spending (budget + potential fees)
      const approveAmount = ethers.parseEther("2000");
      await token
        .connect(donor)
        .approve(await cashV2.getAddress(), approveAmount);
    });

    it("create batch, add recipients, process batch transfers from donor", async () => {
      // create batch
      await expect(cashV2.connect(processor).createBatch(projectId)).to.emit(
        cashV2,
        "BatchCreated"
      );
      const batchId = await cashV2.nextBatchSeq(projectId);

      // add recipients
      await cashV2
        .connect(processor)
        .addRecipients(projectId, batchId, recipients, batchAmounts);

      const expectedAmount = batchAmounts[0] + batchAmounts[1];
      // process
      const donorBalBefore = await token.balanceOf(donor.address);
      const orgBalBefore = await token.balanceOf(organisation.address);
      const feeBalBefore = await token.balanceOf(feeReceiver.address);

      await expect(
        cashV2.connect(processor).processBatch(projectId, batchId)
      ).to.emit(cashV2, "BatchProcessed");

      const fee = (expectedAmount * BigInt(processingFeeBps)) / 10000n;
      const donorBalAfter = await token.balanceOf(donor.address);
      const orgBalAfter = await token.balanceOf(organisation.address);
      const feeBalAfter = await token.balanceOf(feeReceiver.address);

      expect(orgBalAfter - orgBalBefore).to.equal(expectedAmount);
      expect(feeBalAfter - feeBalBefore).to.equal(fee);
      expect(donorBalBefore - donorBalAfter).to.equal(expectedAmount + fee);
    });

    it("completes project, distributes org fees from donor, mints receipt", async () => {
      // one batch of 100
      await cashV2.connect(processor).createBatch(projectId);
      const batchId = await cashV2.nextBatchSeq(projectId);
      const amt = ethers.parseEther("100");
      await cashV2
        .connect(processor)
        .addRecipients(projectId, batchId, ["hh1"], [amt]);
      await cashV2.connect(processor).processBatch(projectId, batchId);

      const orgBefore = await token.balanceOf(organisation.address);
      const feeBefore = await token.balanceOf(feeReceiver.address);

      const donorBefore = await token.balanceOf(donor.address);
      // complete project -> distribute org fee on paid amount (5% of 100)
      await expect(cashV2.completeProject(projectId)).to.emit(
        cashV2,
        "ProjectCompleted"
      );

      const orgFeeTotal = (amt * BigInt(orgFeeA + orgFeeB)) / 10000n; // 5%
      const donorAfter = await token.balanceOf(donor.address);

      // orgFee split 3% + 2% -> recipients were organisation and feeReceiver as example
      const orgAfter = await token.balanceOf(organisation.address);
      const feeAfter = await token.balanceOf(feeReceiver.address);

      expect(orgAfter - orgBefore + feeAfter - feeBefore).to.equal(orgFeeTotal);
      // donor paid the org fee on completion
      expect(donorBefore - donorAfter).to.equal(orgFeeTotal);

      // tokenURI includes base + contract + "/" + projectId
      const uri = await cashV2.tokenURI(projectId);
      const addr = (await cashV2.getAddress()).toLowerCase();
      expect(uri).to.equal(`${BASE}${addr}/${projectId}`);
    });
  });

  describe("Prefunded project flow", () => {
    let projectId: bigint;
    const budget = ethers.parseEther("500");
    const projectKey = "proj-key-2";

    beforeEach(async () => {
      await cashV2.createProject(
        organisation.address,
        await token.getAddress(),
        budget,
        donor.address,
        projectKey,
        [organisation.address],
        [1000] // 10% org fee
      );
      projectId = (await cashV2.nextProjectId()) - 1n;

      // Donor approves for upfront prefunding (budget + fees on full budget)
      const upfrontProcFee = (budget * BigInt(processingFeeBps)) / 10000n;
      const upfrontOrgFee = (budget * 1000n) / 10000n; // 10%
      const total = budget + upfrontProcFee + upfrontOrgFee;
      await token.connect(donor).approve(await cashV2.getAddress(), total);
    });

    it("prefund, process batch uses contract balance; completion refunds leftovers", async () => {
      // prefund
      const donorBefore = await token.balanceOf(donor.address);
      const contractBefore = await token.balanceOf(await cashV2.getAddress());
      await expect(cashV2.connect(donor).prefundProject(projectId)).to.emit(
        cashV2,
        "ProjectPrefunded"
      );
      const contractAfter = await token.balanceOf(await cashV2.getAddress());
      expect(contractAfter).to.be.greaterThan(contractBefore);
      expect(donorBefore - (await token.balanceOf(donor.address))).to.equal(
        contractAfter - contractBefore
      );

      // create/process a batch for half the budget
      await cashV2.connect(processor).createBatch(projectId);
      const batchId = await cashV2.nextBatchSeq(projectId);
      const amt = ethers.parseEther("250");
      await cashV2
        .connect(processor)
        .addRecipients(projectId, batchId, ["hh1"], [amt]);

      const orgBefore = await token.balanceOf(organisation.address);
      const feeBefore = await token.balanceOf(feeReceiver.address);
      await cashV2.connect(processor).processBatch(projectId, batchId);
      const fee = (amt * BigInt(processingFeeBps)) / 10000n;
      const orgAfter = await token.balanceOf(organisation.address);
      const feeAfter = await token.balanceOf(feeReceiver.address);

      // Transfers from contract (prefunded)
      expect(orgAfter - orgBefore).to.equal(amt);
      expect(feeAfter - feeBefore).to.equal(fee);

      // complete -> refunds unused budget + unpaid fees to donor
      const donorBalBefore = await token.balanceOf(donor.address);
      await cashV2.completeProject(projectId);
      const donorBalAfter = await token.balanceOf(donor.address);
      expect(donorBalAfter).to.be.greaterThan(donorBalBefore);
    });
  });

  describe("Permissions and validation", () => {
    it("only admin can create project", async () => {
      const nonAdmin = (await ethers.getSigners())[6];
      await expect(
        cashV2
          .connect(nonAdmin)
          .createProject(
            nonAdmin.address,
            await token.getAddress(),
            ethers.parseEther("1"),
            nonAdmin.address,
            "x",
            [],
            []
          )
      ).to.be.reverted;
    });

    it("only processor can create batches/add recipients/process", async () => {
      await cashV2.createProject(
        organisation.address,
        await token.getAddress(),
        ethers.parseEther("10"),
        donor.address,
        "k",
        [],
        []
      );
      const projectId = (await cashV2.nextProjectId()) - 1n;

      await expect(cashV2.createBatch(projectId)).to.be.reverted; // caller not processor

      await cashV2.connect(processor).createBatch(projectId);
      const batchId = await cashV2.nextBatchSeq(projectId);

      await expect(cashV2.addRecipients(projectId, batchId, ["h"], [1])).to.be
        .reverted;

      await expect(cashV2.processBatch(projectId, batchId)).to.be.reverted;
    });

    it("cannot exceed budget when adding recipients", async () => {
      await cashV2.createProject(
        organisation.address,
        await token.getAddress(),
        ethers.parseEther("10"),
        donor.address,
        "k",
        [],
        []
      );
      const projectId = (await cashV2.nextProjectId()) - 1n;
      await cashV2.connect(processor).createBatch(projectId);
      const batchId = await cashV2.nextBatchSeq(projectId);

      // Add almost all budget
      await cashV2
        .connect(processor)
        .addRecipients(projectId, batchId, ["h1"], [ethers.parseEther("9")]);

      // Try to add more than remaining
      await expect(
        cashV2
          .connect(processor)
          .addRecipients(projectId, batchId, ["h2"], [ethers.parseEther("2")])
      ).to.be.revertedWith("exceeds budget");
    });
  });
});
