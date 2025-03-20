import { expect } from "chai"
import { ethers, network } from "hardhat"
import { CoalaPayCashPayments, TokenERC20 } from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"

describe("CoalaPayCashPayments", function () {
  let cashPayments: CoalaPayCashPayments
  let token: TokenERC20
  let admin: SignerWithAddress
  let vendor: SignerWithAddress
  let holdingAccount: SignerWithAddress
  let fundingAccount: SignerWithAddress
  let otherSigners: SignerWithAddress[]
  
  const disbursementAmount = ethers.parseEther("100")
  const cycleId = 1
  let startTimestamp: number
  let endTimestamp: number

  beforeEach(async () => {
    // Reset state before each test
    await network.provider.send("hardhat_reset", [])

    const signers = await ethers.getSigners()
    admin = signers[0]
    vendor = signers[1]
    holdingAccount = signers[2]        // This account will hold the tokens
    fundingAccount = signers[3]
    otherSigners = signers.slice(3)

    // Deploy CoalaPayCashPayments, passing the holding account to the constructor
    const CashPaymentsFactory = await ethers.getContractFactory("CoalaPayCashPayments")
    cashPayments = (await CashPaymentsFactory.deploy(holdingAccount.address, fundingAccount.address)) as CoalaPayCashPayments
    await cashPayments.waitForDeployment()

    // Deploy a mock ERC20 token
    const TokenFactory = await ethers.getContractFactory("TokenERC20")
    token = (await TokenFactory.deploy()) as TokenERC20
    await token.waitForDeployment()

    // Mint tokens to the holding account
    await token.mint(holdingAccount.address, ethers.parseEther("1000"))

    // Approve the CoalaPayCashPayments contract to spend holdingAccount's tokens
    await token.connect(holdingAccount).approve(
      await cashPayments.getAddress(),
      ethers.parseEther("1000")
    )

    // Set up a valid payment cycle: started 100 seconds ago and ends in 1000 seconds
    const currentBlock = await ethers.provider.getBlock("latest")
    if (!currentBlock) {
      throw new Error("Failed to fetch the latest block")
    }
    startTimestamp = currentBlock.timestamp - 100
    endTimestamp = currentBlock.timestamp + 1000

    await cashPayments.setPaymentCycle(
      cycleId,
      startTimestamp,
      endTimestamp,
      await token.getAddress(),
      disbursementAmount
    )
  })

  describe("Deployment", function () {
    it("should set the deployer as the default admin", async function () {
      const DEFAULT_ADMIN_ROLE = await cashPayments.DEFAULT_ADMIN_ROLE()
      expect(await cashPayments.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true)
    })

    it("should set the holdingAccount address in the constructor", async function () {
      expect(await cashPayments.holdingAccount()).to.equal(holdingAccount.address)
    })
  })

  describe("Whitelist Functions", function () {
    const userId = "user1"

    it("allows admin to whitelist and remove a user", async function () {
      await expect(cashPayments.whitelistUser(userId))
        .to.emit(cashPayments, "UserWhitelisted")
        .withArgs(userId)
      expect(await cashPayments.whitelistedUsers(userId)).to.equal(true)

      await expect(cashPayments.removeWhitelistUser(userId))
        .to.emit(cashPayments, "UserRemovedFromWhitelist")
        .withArgs(userId)
      expect(await cashPayments.whitelistedUsers(userId)).to.equal(false)
    })

    it("allows admin to bulk whitelist and bulk remove users", async function () {
      const users = ["user1", "user2", "user3"]

      // Bulk whitelist
      await expect(cashPayments.bulkWhitelistUsers(users))
        .to.emit(cashPayments, "UserWhitelisted")
      for (const u of users) {
        expect(await cashPayments.whitelistedUsers(u)).to.equal(true)
      }

      // Bulk remove
      await expect(cashPayments.bulkRemoveWhitelistUsers(users))
        .to.emit(cashPayments, "UserRemovedFromWhitelist")
      for (const u of users) {
        expect(await cashPayments.whitelistedUsers(u)).to.equal(false)
      }
    })
  })

  describe("PaymentCycle Functions", function () {
    it("sets a payment cycle correctly", async function () {
      const cycle = await cashPayments.paymentCycles(cycleId)
      expect(cycle.startTimestamp).to.equal(startTimestamp)
      expect(cycle.endTimestamp).to.equal(endTimestamp)
      expect(cycle.paymentToken).to.equal(await token.getAddress())
      expect(cycle.disbursementAmount).to.equal(disbursementAmount)
    })

    it("reverts when setting an invalid payment cycle", async function () {
      const invalidStart = Math.floor(Date.now() / 1000) + 1000
      const invalidEnd = Math.floor(Date.now() / 1000) + 500
      await expect(
        cashPayments.setPaymentCycle(
          2,
          invalidStart,
          invalidEnd,
          await token.getAddress(),
          disbursementAmount
        )
      ).to.be.revertedWith("Invalid time window")
    })
  })

  describe("requestFunding", function () {
    const userId = "user1"
    const usedCycleId = cycleId

    beforeEach(async () => {
      // Whitelist the user before testing funding
      await cashPayments.whitelistUser(userId)
      // Grant FUNDER_ROLE to vendor so that they can call requestFunding
      await cashPayments.grantFunderRole(vendor.address)
    })

    it("successfully processes a funding request", async function () {
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, usedCycleId)
      )
        .to.emit(cashPayments, "FundingDisbursed")
        .withArgs(userId, usedCycleId, vendor.address, disbursementAmount)

      // Verify that the user is marked as redeemed for the cycle.
      expect(await cashPayments.hasRedeemed(userId, usedCycleId)).to.equal(true)

      // Verify that vendor received tokens (coming from holdingAccount, via transferFrom).
      const vendorBalance = await token.balanceOf(fundingAccount.address)
      expect(vendorBalance).to.equal(disbursementAmount)
    })

    it("reverts if the user is not whitelisted", async function () {
      await cashPayments.removeWhitelistUser(userId)
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, usedCycleId)
      ).to.be.revertedWith("User not whitelisted")
    })

    it("reverts if the payment cycle is not active", async function () {
      // Create a future cycle that is not active yet
      const currentBlock = await ethers.provider.getBlock("latest")
      if (!currentBlock) {
        throw new Error("Failed to fetch the latest block")
      }
      const futureStart = currentBlock.timestamp + 1000
      const futureEnd = currentBlock.timestamp + 2000
      const futureCycleId = 2

      await cashPayments.setPaymentCycle(
        futureCycleId,
        futureStart,
        futureEnd,
        await token.getAddress(),
        disbursementAmount
      )

      await expect(
        cashPayments.connect(vendor).requestFunding(userId, futureCycleId)
      ).to.be.revertedWith("Cycle not active")
    })

    it("reverts if caller does not have FUNDER_ROLE", async function () {
      // Revoke FUNDER_ROLE from vendor
      await cashPayments.revokeFunderRole(vendor.address)
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, usedCycleId)
      ).to.be.reverted
    })

    it("reverts if the user has already redeemed in this cycle", async function () {
      // First redemption succeeds
      await cashPayments.connect(vendor).requestFunding(userId, usedCycleId)

      // Second redemption attempt should revert
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, usedCycleId)
      ).to.be.revertedWith("Already redeemed in this cycle")
    })
  })
})
