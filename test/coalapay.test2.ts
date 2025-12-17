import { expect } from "chai";
import { ethers, network } from "hardhat";
import { CoalaPayV2, TokenERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
const { parseEther } = ethers;

const RECEIVER_ADDRESS = "0xF8D7903Ea747943Ed32Dc5b25e2Cc51Cc17F5106";
const FEE_RECEIVER = "0x21c10038fC68d1f05400b2693dAe30772a1736a3";
const SALE_AMOUNT = parseEther("0.1");
const FEE_AMOUNT = (SALE_AMOUNT * BigInt(5)) / BigInt(100);
const NAME = "Coala Pay";
const SYMBOL = "COALA";
const INITIAL_TOKEN_URI = "https://tokenuri.com/initial";
const TOKEN_URI = "https://tokenuri.com/";
const PROJECT_ID = "abc123";

const PaymentType = {
  ESCROW: 0,
  AUTHORISED: 1,
};

describe("CoalapayV2 Token", function () {
  let coalaPayContract: CoalaPayV2,
    owner: SignerWithAddress,
    buyer: SignerWithAddress,
    buyer_2: SignerWithAddress,
    accounts: SignerWithAddress[],
    mockToken: TokenERC20;

  beforeEach(async () => {
    await network.provider.send("hardhat_reset", []);
    accounts = await ethers.getSigners();
    owner = accounts[0];
    buyer = accounts[1];
    buyer_2 = accounts[2];

    const coalaPayImpl = await ethers.getContractFactory("CoalaPayV2");
    coalaPayContract = await coalaPayImpl.deploy(
      NAME,
      SYMBOL,
      INITIAL_TOKEN_URI,
      owner.address,
      FEE_RECEIVER
    );

    const mockTokenImpl = await ethers.getContractFactory("TokenERC20");
    mockToken = await mockTokenImpl.deploy();
    await mockToken.mint(buyer.address, (SALE_AMOUNT + FEE_AMOUNT) * BigInt(2));

    const mockTokenAsBuyer = await mockToken.connect(buyer);
    await mockTokenAsBuyer.approve(
      await coalaPayContract.getAddress(),
      (SALE_AMOUNT + FEE_AMOUNT) * BigInt(2)
    );
  });

  describe("Deployment", function () {
    it("Should have correct name and symbol", async function () {
      const name = await coalaPayContract.name();
      const symbol = await coalaPayContract.symbol();
      expect(name).to.equal(NAME);
      expect(symbol).to.equal(SYMBOL);
    });
  });

  describe("Token Creation", function () {
    beforeEach(async () => {
      let contractArgs = {
        inited: false,
        paymentType: PaymentType.ESCROW,
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress(),
        milestones: [
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      await coalaPayContract.addToken(contractArgs, PROJECT_ID);
    });

    it("Displays correct amount and fee", async function () {
      const tokenId = 0;
      const { fee } = await coalaPayContract.getTokenInfo(tokenId);
      expect(fee).to.equal(FEE_AMOUNT);
    });

    it("Displays correct milestones", async function () {
      const tokenId = 0;
      const { milestone } = await coalaPayContract.getMilestoneInfo(tokenId, 0);
      expect(milestone.amount).to.equal(parseEther("0.03"));
      expect(milestone.paid).to.equal(false);
      expect(milestone.date).to.equal(0);
    });

    it("Mints with correct eth amount", async function () {
      const tokenId = 0;
      const milestoneId = 0;
      const { tokenInfo, fee } = await coalaPayContract.getTokenInfo(tokenId);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await expect(
        coalaPayAsBuyer.payMilestone(tokenId, milestoneId, {
          value: tokenInfo.price + fee,
        })
      ).not.be.reverted;

      const { milestone } = await coalaPayContract.getMilestoneInfo(
        tokenId,
        milestoneId
      );
      expect(milestone.paid).to.equal(true);
    });

    it("Reverts when minting same token id", async function () {
      const tokenId = 0;
      const milestoneId = 0;
      const { tokenInfo, fee } = await coalaPayContract.getTokenInfo(tokenId);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await expect(
        coalaPayAsBuyer.payMilestone(tokenId, milestoneId, {
          value: tokenInfo.price + fee,
        })
      ).not.be.reverted;

      const coalaPayAsBuyer2 = await coalaPayContract.connect(buyer_2);
      await expect(
        coalaPayAsBuyer2.payMilestone(tokenId, milestoneId, {
          value: tokenInfo.price + fee,
        })
      ).to.be.revertedWithCustomError;
    });

    it("Has correct token owner", async function () {
      let { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0, {
        value: tokenInfo.price + fee,
      });
      ({ tokenInfo } = await coalaPayContract.getTokenInfo(0));
      expect(tokenInfo.donor).to.equal(buyer.address);

      await coalaPayAsBuyer.payMilestone(0, 1);
      let { milestone } = await coalaPayContract.getMilestoneInfo(0, 0);
      expect(milestone.paid).to.equal(true);
      ({ milestone } = await coalaPayContract.getMilestoneInfo(0, 1));
      expect(milestone.paid).to.equal(true);

      const owner = await coalaPayContract.ownerOf(0);
      expect(owner).to.equal(tokenInfo.donor);
    });

    it("Sequence error", async function () {
      let { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await expect(
        coalaPayAsBuyer.payMilestone(0, 1, {
          value: tokenInfo.price + fee,
        })
      ).to.be.revertedWith("Sequence error");
    });

    it("Admin can mint token without payment", async function () {
      const tokenId = 0;
      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.adminMint(buyer.address, tokenId)).not.be
        .reverted;

      const tokenOwnerAddress = await coalaPayContract.ownerOf(tokenId);
      expect(tokenOwnerAddress).to.equal(buyer.address);
    });

    it("Cannot mint a token that has not been set", async function () {
      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.adminMint(buyer.address, 10)).to.not.be
        .reverted;
    });
  });

  describe("ERC20 minting", function () {
    beforeEach(async () => {
      let contractArgs = {
        inited: false,
        paymentType: PaymentType.ESCROW,
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress(),
        milestones: [
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      await coalaPayContract.addToken(contractArgs, PROJECT_ID);
    });

    it("Can mint with ERC20 token", async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await expect(coalaPayAsBuyer.payMilestone(0, 0)).to.not.be.reverted;

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      const reveiverBalance = await mockToken.balanceOf(RECEIVER_ADDRESS);
      expect(reveiverBalance).to.equal(milestone.amount);

      const feeBalance = await mockToken.balanceOf(FEE_RECEIVER);
      expect(feeBalance).to.equal(milestoneFee);
    });

    it("Distributes funds to project", async function () {
      const { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      const projectBalance = await mockToken.balanceOf(tokenInfo.receiver);
      expect(projectBalance).to.equal(milestone.amount);

      const feeBalance = await mockToken.balanceOf(FEE_RECEIVER);
      expect(feeBalance).to.equal(milestoneFee);
    });

    it("Refund should be possible", async function () {
      let { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      ({ tokenInfo } = await coalaPayContract.getTokenInfo(0));
      expect(tokenInfo.donor).to.equal(buyer.address);

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      expect(milestone.paid).to.equal(true);
      ({ milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 1));
      expect(milestone.paid).to.equal(false);

      const beforeDonorBalance = await mockToken.balanceOf(buyer.address);
      const beforeContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );

      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.refund(0)).to.not.be.reverted;

      const afterDonorBalance = await mockToken.balanceOf(buyer.address);
      const afterContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );
      expect(milestone.amount).to.equal(parseEther("0.07"));
      expect(milestoneFee).to.equal(parseEther("0.0035"));
      expect(afterDonorBalance).to.equal(
        beforeDonorBalance + milestone.amount + milestoneFee
      );
      expect(afterContractBalance).to.equal(
        beforeContractBalance - milestone.amount - milestoneFee
      );
    });

    it("Refund should prevent milestone payment for escrow payment type", async function () {
      let { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      ({ tokenInfo } = await coalaPayContract.getTokenInfo(0));
      expect(tokenInfo.donor).to.equal(buyer.address);

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      expect(milestone.paid).to.equal(true);
      ({ milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 1));
      expect(milestone.paid).to.equal(false);

      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.refund(0)).to.not.be.reverted;
      await expect(coalaPayAsBuyer.payMilestone(0, 1)).to.be.revertedWith(
        "Token is refunded"
      );
    });
  });

  describe("ERC20 minting with authorised payment", function () {
    beforeEach(async () => {
      let contractArgs = {
        inited: false,
        paymentType: PaymentType.AUTHORISED,
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress(),
        milestones: [
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      await coalaPayContract.addToken(contractArgs, PROJECT_ID);
    });

    it("Can mint with ERC20 token", async function () {
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await expect(coalaPayAsBuyer.payMilestone(0, 0)).to.not.be.reverted;

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      const reveiverBalance = await mockToken.balanceOf(RECEIVER_ADDRESS);
      expect(reveiverBalance).to.equal(milestone.amount);

      const feeBalance = await mockToken.balanceOf(FEE_RECEIVER);
      expect(feeBalance).to.equal(milestoneFee);

      const contractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );
      expect(contractBalance).to.equal(0);
    });

    it("Distributes funds to project", async function () {
      const { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      const projectBalance = await mockToken.balanceOf(tokenInfo.receiver);
      expect(projectBalance).to.equal(milestone.amount);

      const feeBalance = await mockToken.balanceOf(FEE_RECEIVER);
      expect(feeBalance).to.equal(milestoneFee);
    });

    it("Refund should prevent milestone payment for authorised payment type", async function () {
      let { tokenInfo, fee } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      ({ tokenInfo } = await coalaPayContract.getTokenInfo(0));
      expect(tokenInfo.donor).to.equal(buyer.address);

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      expect(milestone.paid).to.equal(true);
      ({ milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 1));
      expect(milestone.paid).to.equal(false);

      const beforeDonorBalance = await mockToken.balanceOf(buyer.address);
      const beforeContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );
      const beforeReceiverBalance = await mockToken.balanceOf(RECEIVER_ADDRESS);
      const beforeFeeReceiverBalance = await mockToken.balanceOf(FEE_RECEIVER);

      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.refund(0)).to.not.be.reverted;
      await expect(coalaPayAsBuyer.payMilestone(0, 1)).to.be.revertedWith(
        "Token is refunded"
      );

      // donor and recipient balances should not change

      const afterDonorBalance = await mockToken.balanceOf(buyer.address);
      const afterContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );
      const afterReceiverBalance = await mockToken.balanceOf(RECEIVER_ADDRESS);
      const afterFeeReceiverBalance = await mockToken.balanceOf(FEE_RECEIVER);
      expect(afterDonorBalance).to.equal(beforeDonorBalance);
      expect(afterContractBalance).to.equal(beforeContractBalance);
      expect(afterReceiverBalance).to.equal(beforeReceiverBalance);
      expect(afterFeeReceiverBalance).to.equal(beforeFeeReceiverBalance);
    });
  });

  describe("Metadata Updates", function () {
    const updatedPrice = parseEther("1");
    const updatedPaymentToken = "0xD24e0f48bA59A2627d141228bE7d595055B3BA09";
    const updatedPaymentReceiver = "0xD24e0f48bA59A2627d141228bE7d595055B3BA09";
    const updatedFee = (updatedPrice * BigInt(5)) / BigInt(100);

    beforeEach(async () => {
      let contractArgs = {
        inited: false,
        paymentType: PaymentType.ESCROW,
        receiver: RECEIVER_ADDRESS,
        price: SALE_AMOUNT,
        paymentToken: await mockToken.getAddress(),
        milestones: [
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      await coalaPayContract.addToken(contractArgs, PROJECT_ID);
    });

    it("Set base uri works", async function () {
      await expect(coalaPayContract.setBaseUri(TOKEN_URI)).to.not.be.reverted;
      const tokenUri = await coalaPayContract.tokenURI(0);
      const address = (await coalaPayContract.getAddress()).toLowerCase();
      expect(tokenUri).to.equal(`${TOKEN_URI}${address}/0`);
    });

    it("Update token uri works", async function () {
      const newUri = "https://updateduri.com/0";
      await expect(coalaPayContract.updateTokenUri(0, newUri)).to.not.be
        .reverted;
      const tokenUri = await coalaPayContract.tokenURI(0);
      expect(tokenUri).to.equal(newUri);
    });

    it("Cannot update unminted token", async function () {
      const updatedArgs = {
        inited: false,
        paymentType: PaymentType.ESCROW,
        receiver: updatedPaymentReceiver,
        price: updatedPrice,
        paymentToken: updatedPaymentToken,
        milestones: [
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      await expect(
        coalaPayContract.updateToken(1, updatedArgs)
      ).to.be.revertedWith("Invalid token");
    });

    it("Cannot update with paid milestone", async function () {
      const updatedArgs = {
        inited: false,
        paymentType: PaymentType.ESCROW,
        receiver: updatedPaymentReceiver,
        price: parseEther("0.1"),
        paymentToken: updatedPaymentToken,
        milestones: [
          {
            amount: parseEther("0.07"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.03"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      await expect(
        coalaPayContract.updateToken(0, updatedArgs)
      ).to.be.revertedWith("Token is not updateable");
    });

    it("Update all info works", async function () {
      const updatedArgs = {
        inited: false,
        paymentType: PaymentType.AUTHORISED,
        receiver: updatedPaymentReceiver,
        price: parseEther("1"),
        paymentToken: updatedPaymentToken,
        milestones: [
          {
            amount: parseEther("0.3"),
            paid: false,
            date: 0,
          },
          {
            amount: parseEther("0.7"),
            paid: false,
            date: 10,
          },
        ],
        donor: ethers.ZeroAddress,
        refunded: false,
        milestonesPaid: 0,
      };

      await expect(coalaPayContract.updateToken(0, updatedArgs)).to.not.be
        .reverted;

      const updatedResponse = await coalaPayContract.getTokenInfo(0);
      expect(updatedResponse.tokenInfo.receiver).to.equal(
        updatedPaymentReceiver
      );
      expect(updatedResponse.tokenInfo.paymentToken).to.equal(
        updatedPaymentToken
      );
      expect(updatedResponse.tokenInfo.price).to.equal(updatedPrice);
      expect(updatedResponse.fee).to.equal(updatedFee);
      expect(updatedResponse.tokenInfo.paymentType).to.equal(
        PaymentType.AUTHORISED
      );
    });

    it("Refund ERC20 token should be possible", async function () {
      let { tokenInfo } = await coalaPayContract.getTokenInfo(0);
      const coalaPayAsBuyer = await coalaPayContract.connect(buyer);
      await coalaPayAsBuyer.payMilestone(0, 0);
      ({ tokenInfo } = await coalaPayContract.getTokenInfo(0));
      expect(tokenInfo.donor).to.equal(buyer.address);

      let { milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 0);
      expect(milestone.paid).to.equal(true);
      ({ milestone, fee: milestoneFee } =
        await coalaPayContract.getMilestoneInfo(0, 1));
      expect(milestone.paid).to.equal(false);

      const beforeDonorBalance = await mockToken.balanceOf(buyer.address);
      const beforeContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );

      const coalaPayAsOwner = await coalaPayContract.connect(owner);
      await expect(coalaPayAsOwner.refund(0)).to.not.be.reverted;

      const afterDonorBalance = await mockToken.balanceOf(buyer.address);
      const afterContractBalance = await mockToken.balanceOf(
        await coalaPayContract.getAddress()
      );
      expect(milestone.amount).to.equal(parseEther("0.07"));
      expect(milestoneFee).to.equal(parseEther("0.0035"));
      expect(afterDonorBalance).to.equal(
        beforeDonorBalance + milestone.amount + milestoneFee
      );
      expect(afterContractBalance).to.equal(
        beforeContractBalance - milestone.amount - milestoneFee
      );
    });
  });
});
