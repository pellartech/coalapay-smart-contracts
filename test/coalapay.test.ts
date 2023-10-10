import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { CoalaPay, TokenERC20 } from '../typechain-types'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'
const { parseEther } = ethers

const RECEIVER_ADDRESS = '0xF8D7903Ea747943Ed32Dc5b25e2Cc51Cc17F5106'
const SALE_AMOUNT = parseEther('0.1')
const NAME = 'Coala Pay'
const SYMBOL = 'CPAY'
const TOKEN_URI = 'https://tokenuri.com/'

describe('Coala Pay Token', function () {
  let coalaPayContract: CoalaPay,
    owner: SignerWithAddress,
    buyer: SignerWithAddress,
    buyer_2: SignerWithAddress,
    accounts: SignerWithAddress[],
    mockToken: TokenERC20

  beforeEach(async () => {
    await network.provider.send('hardhat_reset', [])
    accounts = await ethers.getSigners()
    owner = accounts[0]
    buyer = accounts[1]
    buyer_2 = accounts[2]

    const coalaPayImpl = await ethers.getContractFactory('CoalaPay')
    coalaPayContract = await coalaPayImpl.deploy()

    const mockTokenImpl = await ethers.getContractFactory('TokenERC20')
    mockToken = await mockTokenImpl.deploy()
    await mockToken.mint(buyer.address, SALE_AMOUNT)

    const mockTokenAsBuyer = await mockToken.connect(buyer)
    await mockTokenAsBuyer.approve(
      await coalaPayContract.getAddress(),
      SALE_AMOUNT
    )
  })

  describe('Deployment', function () {
    it('Should have correct name and symbol', async function () {
      const name = await coalaPayContract.name()
      const symbol = await coalaPayContract.symbol()
      expect(name).to.equal(NAME)
      expect(symbol).to.equal(SYMBOL)
    })
  })

  describe('Token Creation', function () {
    beforeEach(async () => {
      let contractArgs = {
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: ethers.ZeroAddress
      }
      await coalaPayContract.addToken(contractArgs)
    })

    it('Fails to mint with incorrect eth amount', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      await expect(
        coalaPayAsBuyer.mint(buyer.address, 0, {
          value: parseEther('0.001')
        })
      ).to.be.revertedWith('Incorrect token price')
    })

    it('Mints with correct eth amount', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      await expect(
        coalaPayAsBuyer.mint(buyer.address, 0, {
          value: SALE_AMOUNT
        })
      ).not.be.reverted
    })

    it('Reverts when minting same token id', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      coalaPayAsBuyer.mint(buyer.address, 0, {
        value: SALE_AMOUNT
      })

      const coalaPayAsBuyer2 = await coalaPayContract.connect(buyer_2)
      await expect(
        coalaPayAsBuyer2.mint(buyer_2.address, 0, {
          value: SALE_AMOUNT
        })
      ).to.be.revertedWithCustomError
    })

    it('Has correct token owner', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      await coalaPayAsBuyer.mint(buyer.address, 0, {
        value: SALE_AMOUNT
      })
      const owner = await coalaPayContract.ownerOf(0)
      expect(owner).to.equal(buyer.address)
    })

    it('Distributes funds to project', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      await coalaPayAsBuyer.mint(buyer.address, 0, {
        value: SALE_AMOUNT
      })
      const projectBalance = await ethers.provider.getBalance(RECEIVER_ADDRESS)
      expect(projectBalance).to.equal(SALE_AMOUNT)
    })

    it('Admin can mint token without payment', async function () {
      const coalaPayAsOwner = await coalaPayContract.connect(owner)
      expect(await coalaPayAsOwner.adminMint(buyer.address, 0)).to.not.be
        .reverted

      const tokenOwnerAddress = await coalaPayContract.ownerOf(0)
      expect(tokenOwnerAddress).to.equal(buyer.address)
    })
  })

  describe('ERC20 minting', function () {
    beforeEach(async () => {
      let contractArgs = {
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress()
      }
      await coalaPayContract.addToken(contractArgs)
    })

    it('Can mint with ERC20 token', async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer)
      await expect(
        coalaPayAsBuyer.mint(buyer.address, 0, {
          value: SALE_AMOUNT
        })
      ).to.not.be.reverted

      const reveiverBalance = await mockToken.balanceOf(RECEIVER_ADDRESS)
      expect(reveiverBalance).to.equal(SALE_AMOUNT)
    })
  })

  describe('Metadata Updates', function () {
    const updatedPrice = parseEther('1')
    const updatedPaymentToken = ethers.ZeroAddress
    const updatedPaymentReceiver = '0xD24e0f48bA59A2627d141228bE7d595055B3BA09'

    beforeEach(async () => {
      let contractArgs = {
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress()
      }
      await coalaPayContract.addToken(contractArgs)
    })

    it('Set base uri works', async function () {
      await expect(coalaPayContract.setBaseUri(TOKEN_URI)).to.not.be.reverted
      const tokenUri = await coalaPayContract.tokenURI(0)
      expect(tokenUri).to.equal(`${TOKEN_URI}0`)
    })

    it('Update token uri works', async function () {
      const newUri = 'https://updateduri.com/0'
      await expect(coalaPayContract.updateTokenUri(0, newUri)).to.not.be
        .reverted
      const tokenUri = await coalaPayContract.tokenURI(0)
      expect(tokenUri).to.equal(newUri)
    })

    it('Cannot update unminted token', async function () {
      const updatedArgs = {
        receiver: updatedPaymentReceiver,
        price: updatedPrice,
        paymentToken: updatedPaymentToken
      }
      await expect(
        coalaPayContract.updateToken(1, updatedArgs)
      ).to.be.revertedWith('Invalid token')
    })

    it('Update all info works', async function () {
      const updatedArgs = {
        receiver: updatedPaymentReceiver,
        price: updatedPrice,
        paymentToken: updatedPaymentToken
      }
      await expect(coalaPayContract.updateToken(0, updatedArgs)).to.not.be
        .reverted

      const updatedResponse = await coalaPayContract.tokenInfo(0)
      expect(updatedResponse).to.deep.equal([
        updatedPaymentReceiver,
        updatedPaymentToken,
        updatedPrice
      ])
    })
  })
})
