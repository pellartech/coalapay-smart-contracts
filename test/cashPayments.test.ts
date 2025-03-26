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
  let feeReceiver: SignerWithAddress

  let otherSigners: SignerWithAddress[]

  // Example: 100 tokens disbursed each time
  const disbursementAmount = ethers.parseEther("100")
  // Example: 500 => 5% fee (because FEE_DIVISOR = 10000 in contract)
  const initialFeePercent = 500

  // We'll set up one payment cycle with this ID
  const cycleId = 1
  let startTimestamp: number
  let endTimestamp: number

  beforeEach(async () => {
    // Reset state before each test
    await network.provider.send("hardhat_reset", [])

    const signers = await ethers.getSigners()
    admin = signers[0]
    vendor = signers[1]
    holdingAccount = signers[2]
    fundingAccount = signers[3]
    feeReceiver = signers[4]
    otherSigners = signers.slice(5)

    // Deploy CoalaPayCashPayments with the updated constructor
    const CashPaymentsFactory = await ethers.getContractFactory("CoalaPayCashPayments")
    cashPayments = (await CashPaymentsFactory.deploy(
      holdingAccount.address,
      fundingAccount.address,
      feeReceiver.address,
      initialFeePercent
    )) as CoalaPayCashPayments
    await cashPayments.waitForDeployment()

    // Deploy a mock ERC20 token
    const TokenFactory = await ethers.getContractFactory("TokenERC20")
    token = (await TokenFactory.deploy()) as TokenERC20
    await token.waitForDeployment()

    // Mint tokens to the holding account
    await token.mint(holdingAccount.address, ethers.parseEther("100000"))

    // Approve the CoalaPayCashPayments contract to spend holdingAccount's tokens
    await token
      .connect(holdingAccount)
      .approve(await cashPayments.getAddress(), ethers.parseEther("100000"))

    // Set up a valid payment cycle: started 100 seconds ago, ends in 1000 seconds
    const currentBlock = await ethers.provider.getBlock("latest")
    if (!currentBlock) {
      throw new Error("Failed to fetch the latest block")
    }
    startTimestamp = currentBlock.timestamp - 100
    endTimestamp = currentBlock.timestamp + 1000

    // The admin needs PAYMENT_CYCLE_ROLE to call setPaymentCycle
    await cashPayments.grantRole(await cashPayments.PAYMENT_CYCLE_ROLE(), admin.address)
    await cashPayments.setPaymentCycle(
      cycleId,
      startTimestamp,
      endTimestamp,
      await token.getAddress(),
      disbursementAmount
    )
  })

  describe("Deployment", function () {
    it("should set the deployer as the default admin and funder", async function () {
      const DEFAULT_ADMIN_ROLE = await cashPayments.DEFAULT_ADMIN_ROLE()
      const FUNDER_ROLE = await cashPayments.FUNDER_ROLE()

      expect(await cashPayments.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true)
      expect(await cashPayments.hasRole(FUNDER_ROLE, admin.address)).to.equal(true)
    })

    it("should store the constructor arguments correctly", async function () {
      expect(await cashPayments.holdingAccount()).to.equal(holdingAccount.address)
      expect(await cashPayments.fundingAccount()).to.equal(fundingAccount.address)
      expect(await cashPayments.feeReceiver()).to.equal(feeReceiver.address)
      expect(await cashPayments.feePercent()).to.equal(initialFeePercent)
    })
  })

  describe("Whitelist Functions", function () {
    const userId = "user1"

    beforeEach(async () => {
      // The admin needs WHITELIST_USER_ROLE to use these functions
      await cashPayments.grantRole(await cashPayments.WHITELIST_USER_ROLE(), admin.address)
    })

    it("allows whitelisting and removing a user", async function () {
      await expect(cashPayments.whitelistUser(userId))
        .to.emit(cashPayments, "UserWhitelisted")
        .withArgs(userId)
      expect(await cashPayments.whitelistedUsers(userId)).to.equal(true)

      await expect(cashPayments.removeWhitelistUser(userId))
        .to.emit(cashPayments, "UserRemovedFromWhitelist")
        .withArgs(userId)
      expect(await cashPayments.whitelistedUsers(userId)).to.equal(false)
    })

    it("allows bulk whitelist and bulk remove users", async function () {
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

    beforeEach(async () => {
      // Grant the admin WHITELIST_USER_ROLE so we can whitelist user
      await cashPayments.grantRole(await cashPayments.WHITELIST_USER_ROLE(), admin.address)
      await cashPayments.whitelistUser(userId)

      // Grant FUNDER_ROLE to vendor so they can call requestFunding
      await cashPayments.grantRole(await cashPayments.FUNDER_ROLE(), vendor.address)
    })

    it("successfully processes a funding request, transferring fee and remainder", async function () {
      const feeDivisor = await cashPayments.FEE_DIVISOR()
      const feePercent = await cashPayments.feePercent()

      // Check starting balances
      const startingFundingBalance = await token.balanceOf(fundingAccount.address)
      const startingFeeBalance = await token.balanceOf(feeReceiver.address)

      // Vendor calls requestFunding
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, cycleId)
      )
        .to.emit(cashPayments, "FundingDisbursed")
        .withArgs(userId, cycleId, vendor.address, disbursementAmount)

      // Verify the user is marked as redeemed
      expect(await cashPayments.hasRedeemed(userId, cycleId)).to.equal(true)

      // Check final balances
      const endingFundingBalance = await token.balanceOf(fundingAccount.address)
      const endingFeeBalance = await token.balanceOf(feeReceiver.address)

      // fee = (disbursementAmount * feePercent) / feeDivisor
      const expectedFee = disbursementAmount * BigInt(feePercent) / BigInt(feeDivisor)
      const expectedFundingReceived = disbursementAmount

      expect(endingFundingBalance - startingFundingBalance).to.equal(expectedFundingReceived)
      expect(endingFeeBalance - startingFeeBalance).to.equal(expectedFee)
    })

    it("reverts if user is not whitelisted", async function () {
      await cashPayments.removeWhitelistUser(userId)
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, cycleId)
      ).to.be.revertedWith("User not whitelisted")
    })

    it("reverts if the payment cycle is not active", async function () {
      // Create a future cycle that hasn't started
      const currentBlock = await ethers.provider.getBlock("latest")
      if (!currentBlock) throw new Error("Failed to get block")

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
      await cashPayments.revokeRole(await cashPayments.FUNDER_ROLE(), vendor.address)
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, cycleId)
      ).to.be.reverted
    })

    it("reverts if user has already redeemed in this cycle", async function () {
      // First redemption
      await cashPayments.connect(vendor).requestFunding(userId, cycleId)
      // Second redemption attempt
      await expect(
        cashPayments.connect(vendor).requestFunding(userId, cycleId)
      ).to.be.revertedWith("Already redeemed in this cycle")
    })
  })

  describe("bulkRequestFunding", () => {
    const userIds = ["user1", "user2", "user3", "user4"]

    beforeEach(async () => {
      // Whitelist each user
      await cashPayments.grantRole(await cashPayments.WHITELIST_USER_ROLE(), admin.address)
      await cashPayments.bulkWhitelistUsers(userIds)

      // Grant FUNDER_ROLE to vendor
      await cashPayments.grantRole(await cashPayments.FUNDER_ROLE(), vendor.address)
    })

    it("bulk funding processes valid users, collects fees, and emits events", async function () {
      // Let's remove user3 from the whitelist and pre-redeem user4
      await cashPayments.removeWhitelistUser("user3")
      await cashPayments.connect(vendor).requestFunding("user4", cycleId) // user4 is now redeemed

      const feeDivisor = await cashPayments.FEE_DIVISOR()
      const feePercent = await cashPayments.feePercent()

      // Check balances before
      const fundingBefore = await token.balanceOf(fundingAccount.address)
      const feeReceiverBefore = await token.balanceOf(feeReceiver.address)

      // Bulk request
      const tx = await cashPayments.connect(vendor).bulkRequestFunding(userIds, cycleId)
      const receipt = await tx.wait()

      // Check balances after
      const fundingAfter = await token.balanceOf(fundingAccount.address)
      const feeReceiverAfter = await token.balanceOf(feeReceiver.address)

      const successfulCount = 2
      const totalDisbursed = disbursementAmount * BigInt(successfulCount)
      const totalFee = (disbursementAmount * BigInt(feePercent) / BigInt(feeDivisor)) * BigInt(successfulCount)

      expect(fundingAfter - fundingBefore).to.equal(totalDisbursed)
      expect(feeReceiverAfter - feeReceiverBefore).to.equal(totalFee)
    })

    it("does nothing if none of the users are valid", async function () {
      // remove them all from the whitelist
      await cashPayments.bulkRemoveWhitelistUsers(userIds)

      // Check balances before
      const fundingBefore = await token.balanceOf(fundingAccount.address)
      const feeBefore = await token.balanceOf(feeReceiver.address)

      // Attempting bulk request
      await cashPayments.connect(vendor).bulkRequestFunding(userIds, cycleId)

      // Expect no changes
      const fundingAfter = await token.balanceOf(fundingAccount.address)
      const feeAfter = await token.balanceOf(feeReceiver.address)
      expect(fundingAfter).to.equal(fundingBefore)
      expect(feeAfter).to.equal(feeBefore)
    })
  })
})
