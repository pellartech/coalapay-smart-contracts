import { expect } from "chai"
import { ethers, network } from "hardhat"
import { LastMileCashPayments, TokenERC20 } from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"

describe("LastMileCashPayments", () => {
  let lmp:   LastMileCashPayments
  let token: TokenERC20

  let admin:        SignerWithAddress
  let donor:        SignerWithAddress
  let organisation: SignerWithAddress
  let processor:    SignerWithAddress
  let rando:        SignerWithAddress

  const BASE_URI      = "ipfs://test/"
  const NAME          = "LastMileCashPayments"
  const SYMBOL        = "LMP"
  const BUDGET        = ethers.parseEther("1000")
  const BATCH_AMOUNT  = ethers.parseEther("200")
  const BENEFICIARIES = 100
  const PROJECT_KEY   = "demo-key"

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", [])
    ;[admin, donor, organisation, processor, rando] = await ethers.getSigners()

    token = await (await ethers.getContractFactory("TokenERC20"))
      .deploy() as TokenERC20
    await token.mint(donor.address, ethers.parseEther("5000"))

    lmp = await (await ethers.getContractFactory("LastMileCashPayments"))
      .deploy(BASE_URI, NAME, SYMBOL) as LastMileCashPayments
  })

  /* -------------------------------------------------------------------------- */
  /*                               Deployment                                   */
  /* -------------------------------------------------------------------------- */
  describe("Deployment", () => {
    it("sets admin role for deployer", async () => {
      expect(
        await lmp.hasRole(await lmp.DEFAULT_ADMIN_ROLE(), admin.address)
      ).to.be.true
    })

    it("allows baseURI mutation by admin only", async () => {
      await expect(
        lmp.connect(rando).setBaseURI("ipfs://hax/")
      ).to.be.revertedWithCustomError
      await lmp.connect(admin).setBaseURI("ipfs://changed/")
      await lmp.connect(admin).setBaseURI(BASE_URI) // restore
    })
  })

  /* -------------------------------------------------------------------------- */
  /*                               Prefund flow                                 */
  /* -------------------------------------------------------------------------- */
  describe("prefund flow", () => {
    let projectId: bigint
    let batchId:   bigint

    beforeEach(async () => {
      /** 1. Admin creates the project */
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY
      )
      const receipt = await tx.wait()
      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }
      projectId = (receipt.logs[0] as any).args.projectId

      /** 2. Donor approves & prefunds */
      await token.connect(donor).approve(await lmp.getAddress(), BUDGET)
      const pfTx = await lmp.connect(donor).prefundProject(projectId)
      await expect(pfTx)
        .to.emit(lmp, "ProjectPrefunded")
        .withArgs(projectId, donor.address, BUDGET)

      /** 3. Processor role & first batch */
      await lmp.connect(admin).grantRole(
        await lmp.BATCH_PROCESSOR_ROLE(),
        processor.address
      )
      const batchTx = await lmp.connect(processor).createBatch(projectId)
      const log = (await batchTx.wait())!.logs[0] as any
      batchId = log.args.batchId
    })

    it("escrows full budget after prefund", async () => {
      expect(await token.balanceOf(await lmp.getAddress())).to.equal(BUDGET)
      const p = await lmp.projects(projectId)
      expect(p.prefunded).to.be.true
    })

    it("prevents double prefund", async () => {
      await expect(
        lmp.connect(donor).prefundProject(projectId)
      ).to.be.revertedWith("not prefunded") // message from contract
    })

    it("processBatch moves funds from contract → organisation", async () => {
      const startBal = await token.balanceOf(organisation.address)

      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES)

      expect(await token.balanceOf(organisation.address))
        .to.equal(startBal + BATCH_AMOUNT)
    })

    it("completeProject refunds residue & blocks new batches", async () => {
      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES)

      const residue     = BUDGET - BATCH_AMOUNT
      const donorStart  = await token.balanceOf(donor.address)

      await lmp.connect(donor).completeProject(projectId)

      expect(await token.balanceOf(donor.address))
        .to.equal(donorStart + residue)
      await expect(
        lmp.connect(processor).createBatch(projectId)
      ).to.be.revertedWith("invalid project")
    })
  })

  /* -------------------------------------------------------------------------- */
  /*                        Authorise-spend (no prefund) flow                   */
  /* -------------------------------------------------------------------------- */
  describe("authorise-spend flow", () => {
    let projectId: bigint
    let batchId:   bigint

    beforeEach(async () => {
      /** create project */
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY
      )
      projectId = ((await tx.wait())!.logs[0] as any).args.projectId

      /** grant processor & batch */
      await lmp.connect(admin).grantRole(
        await lmp.BATCH_PROCESSOR_ROLE(),
        processor.address
      )
      const btx = await lmp.connect(processor).createBatch(projectId)
      const receipt = await btx.wait()
      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }
      batchId = (receipt.logs[0] as any).args.batchId

      /** donor sets allowance (pulled per batch) */
      await token.connect(donor).approve(await lmp.getAddress(), BUDGET)
    })

    it("does NOT escrow tokens on creation", async () => {
      expect(await token.balanceOf(await lmp.getAddress())).to.equal(0)
      const p = await lmp.projects(projectId)
      expect(p.prefunded).to.be.false
    })

    it("pulls tokens from donor per batch", async () => {
      const donorStart = await token.balanceOf(donor.address)

      await lmp
        .connect(processor)
        .processBatch(batchId, BATCH_AMOUNT, BENEFICIARIES)

      expect(await token.balanceOf(donor.address))
        .to.equal(donorStart - BATCH_AMOUNT)
      expect(await token.balanceOf(organisation.address))
        .to.equal(BATCH_AMOUNT)
    })

    it("no refund on completion when not prefunded", async () => {
      const donorStart = await token.balanceOf(donor.address)
      await lmp.connect(donor).completeProject(projectId)
      expect(await token.balanceOf(donor.address)).to.equal(donorStart)
    })
  })

  /* -------------------------------------------------------------------------- */
  /*                       Negative-path miscellany                             */
  /* -------------------------------------------------------------------------- */
  describe("access & input guards", () => {
    it("non-admin cannot createProject", async () => {
      await expect(
        lmp.connect(rando).createProject(
          organisation.address,
          await token.getAddress(),
          BUDGET,
          donor.address,
          PROJECT_KEY
        )
      ).to.be.revertedWithCustomError
    })

    it("processor role required for createBatch / processBatch", async () => {
      const tx = await lmp.connect(admin).createProject(
        organisation.address,
        await token.getAddress(),
        BUDGET,
        donor.address,
        PROJECT_KEY
      )
      const projectId = ((await tx.wait())!.logs[0] as unknown as { args: { projectId: bigint } }).args.projectId
      await expect(
        lmp.connect(rando).createBatch(projectId)
      ).to.be.revertedWithCustomError
    })
  })
})
