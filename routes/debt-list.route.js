/**
 * @swagger
 * tags:
 *   name: Debt List
 *   description: API to manage actors.
 * components:
 *   schemas:
 *     debt_list:
 *       type: object
 *       required:
 *         - first_name
 *         - last_name
 *       properties:
 *         debt_id:
 *           type: integer
 *           description: The auto-increment id of the category.
 *         user_id:
 *           type: integer
 *           description: The auto-increment id of the category.
 *         first_name:
 *           type: string
 *           description: First name of an actor.
 *         last_name:
 *           type: string
 *           description: Last name of an actor.
 *         last_update:
 *           type: string
 *           format: date
 *           description: The date of the actor creation or update.
 *       example:
 *          actor_id: 1
 *          first_name: Tony
 *          last_name: Stark
 *          last_update: 2006-02-14T21:46:27.000Z
 */
import express from 'express';
import bcrypt from 'bcrypt';
import moment from 'moment';
import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';

import jwt from '../utils/jwt.js';
import createOTP from '../utils/otp.js';
import sendEmail from '../utils/mail.js';
import validate, {validateParams} from '../middlewares/validate.mdw.js';
import {authRole, authUser} from '../middlewares/auth.mdw.js';

import debtListModel from "../models/debt-list.model.js";
import notificationModel from "../models/notification.model.js";
import bankingAccountModel from "../models/banking-account.model.js";
import transactionsModel from "../models/transactions.model.js";
import userModel from "../models/user.model.js";
import debt_status from "../utils/debt_status.js";
import role from "../utils/role.js";

dotenv.config();

const debtCreateSchema = JSON.parse(await readFile(new URL('../schemas/debt-create.json', import.meta.url)));
const debtCancelSchema = JSON.parse(await readFile(new URL('../schemas/debt-cancel.json', import.meta.url)));

const router = express.Router();

//Get debt list of self-made by userId API: /api/debtList/selfMade
router.get("/selfMade",authRole(role.CUSTOMER),async function(req,res){
    try{
        //get userid from body
        const _userId = +req.body.user_id || 0;
        const _user = await userModel.genericMethods.findById(_userId);
        if (_user != null){
            const listDebt = debtListModel.listSelfMade(_userId);
            res.status(200).json({
                isSuccess: true,
                message: "This is all debts of you",
                list_debt: listDebt
            })
        }
        else{
            res.status(500).json({
                isSuccess: false,
                message: "You do not have access",
            })
        }
    }
    catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//Get debt list of other-made by userId API: /api/debtList/otherMade
router.get("/otherMade",authRole(role.CUSTOMER),async function(req,res){
    try{
        //get userid from body
        const _userId = +req.body.user_id || 0;
        const _userBanking = await bankingAccountModel.findByUserId(_userId);
        if (_userBanking != null){
            const userAccountNumber = _userBanking[0].account_number;
            const listDebt = debtListModel.listOtherMade(userAccountNumber);
            res.status(200).json({
                isSuccess: true,
                message: "This is all debts of you",
                list_debt: listDebt
            })
        }
        else{
            res.status(500).json({
                isSuccess: false,
                message: "You do not have access",
            })
        }
    }
    catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//Get detail of debt by debtId API : /api/debtList/:debtId
router.get("/:debtId",authRole(role.CUSTOMER),async function(req,res,next){
    try {
        const _debtId= +req.params.debtId || 0;
        const objDebt = await debtListModel.getDebtById(_debtId)
        if (objDebt != null){
            res.status(200).json({
                isSuccess: true,
                message:"This is detail of debt",
                objDebt: objDebt
            })
        }
        else{
            res.status(500).json({
                isSuccess: false,
                message: "Could not find this debt",
            })
        }
    }catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//Create new debt API (internal): /api/debtList/
router.post("/",validate(debtCreateSchema),authRole(role.CUSTOMER),async function(req,res){
    try{
        const user_id = +req.body.user_id || 0;
        const debt_account_number = req.body.accountNumber || '';
        const debt_amount = +req.body.debt_amount || 0;
        const debt_message= req.body.debt_message || '';
        if (user_id > 0){
            let newDebt = {
                user_id: user_id,
                debt_account_number: debt_account_number,
                debt_amount: debt_amount,
                debt_message: debt_message,
                debt_status: debt_status.NOTPAID,
                debt_cancel_message: ''
            }
            //Create new debt
            const ret = await debtListModel.genericMethods.add(newDebt);
            const recipientIndo = bankingAccountModel.getInfoRecipientBy(debt_account_number);

            //Send mail for recipient
            const VERIFY_EMAIL_SUBJECT = 'Solar Banking: You have new debt';
            const OTP_MESSAGE = `
            Dear ${recipientIndo[0].full_name},\n
            We've noted you have a payment reminder. Debit code is: ${ret[0]}.`;
            sendEmail(recipientIndo[0].email, VERIFY_EMAIL_SUBJECT, OTP_MESSAGE);

            res.status(200).json({
                isSuccess: true,
                message: 'Create new debt successful!'
            })
        }
        res.status(400).json({
            isSuccess: false,
            message: 'You do not have access'
        })
    }catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//send OTP and create temp transaction API: /api/debtList/sendOtp
router.post("/sendOtp",authRole(role.CUSTOMER),async function(req,res,next){
    try{
        const senderId = +req.body.user_id || 0;
        const debtId = +req.body.debt_id || 0;
        const otp = createOTP();
        const debtInfo = await debtListModel.genericMethods.findById(debtId);
        if(debtInfo != null){
            const debtorAccountNumber = debtInfo.debt_account_number;
            const bankingInfoSender = bankingAccountModel.findByUserId(senderId);
            const debtorInfo = bankingAccountModel.getInfoRecipientBy(debtorAccountNumber);
            const emailDebtor = debtorInfo != null ? debtorInfo.email : '';
            const nameDebtor = debtorInfo != null ? debtorInfo.full_name : '';
            const balanceDebtor = debtorInfo != null ? debtorInfo.balance : 0;
            const checkBalance = await bankingAccountModel.checkBalanceOfUserByAccountNumber(debtorAccountNumber,balanceDebtor);
            if (!checkBalance){
                return res.status(500).json({
                    isSuccess: false,
                    message: "Your balance is not enough to make the payment"
                })
            }
            //Create transaction
            let newTransaction = {
                src_account_number: bankingInfoSender != null ? bankingInfoSender[0].account_number : "",
                des_account_number: debtorAccountNumber,
                transaction_amount: debtInfo.debt_amount > 0 ? debtInfo.debt_amount : 0,
                otp_code: otp,
                transaction_message : '',
                pay_transaction_fee: 'DES',
                is_success: 0,
                transaction_type: 1
            };
            const ret = transactionsModel.genericMethods.add(newTransaction);
            //Template mail
            const VERIFY_EMAIL_SUBJECT = 'Solar Banking: Please verify your payment';
            const OTP_MESSAGE = `
            Dear ${nameDebtor},\n
            Here is the OTP code you need to verified payment: ${otp}.\n
            This code will be expired 5 minutes after this email was sent. If you did not make this request, you can ignore this email.   
            `;
            sendEmail(emailDebtor, VERIFY_EMAIL_SUBJECT, OTP_MESSAGE);

            const transactionId = ret[0];
            //update transaction_id in debt table
            debtListModel.updateTransIdDebtPayment(debtId,transactionId);
            res.status(200).json({
                isSuccess: true,
                message: "OTP code has been sent. Please check your email"
            })
        }
        res.status(500).json({
            isSuccess: false,
            message: "Could not find this debt",
        })

    }catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//debt payment API (internal): /api/debtList/internal/verified-payment
router.post("/internal/verified-payment",authRole(role.CUSTOMER),async function(req,res,next){
    try{
        const _debtId = +req.body.debt_id || 0;
        const _otp = +req.body.otp || '';
        const debtDetail = await debtListModel.genericMethods.findById(_debtId);
        if (debtDetail !== null){
            const senderId = debtDetail.user_id;
            const recipientAccount = debtDetail.debt_account_number;
            const debt_amount = debtDetail.debt_amount;
            const transId = debtDetail.paid_transaction_id;
            const transDetail = await transactionsModel.genericMethods.findById(transId);
            //Step 1: Verified OTP code
            if (_otp === transDetail.otp_code && moment().isBefore(transDetail.transaction_created_at)){
                //Step 2: Update status for debt detail
                debtListModel.updateStatusDebtPayment(_debtId,debt_status.PAID);
                //Step 3: Update status of transaction
                transactionsModel.updateStatusTransaction(transId,1);
                //Step 4.1: Update account balance of debtor
                await bankingAccountModel.updateAccountBalance(recipientAccount,debt_amount,1);
                //Step 4.2: Update account balance of debt reminder
                await bankingAccountModel.updateAccountBalance(senderId,debt_amount,2);
                //Step 5: Send notify for debt reminder
                let newNotify = {
                    user_id: senderId,
                    transaction_id: transId,
                    debt_id: _debtId,
                    notification_message: `Debit code ${_debtId} has just been paid. Please check your account`,
                    is_seen: 0
                };
                //add new notification
                await notificationModel.genericMethods.add(newNotify);
                res.status(200).json({
                    isSuccess: true,
                    message: "Payment Successful",
                    status: debt_status.PAID,

                })
            }
            return res.status(500).json({
                isSuccess: false,
                message: 'Validation failed. OTP code may be incorrect or the session was expired!'
            });
        }
        res.status(500).json({
            isSuccess: false,
            message: "Could not find this debt",
        })
    }catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})

//Cancel debt by debtId API: /api/debtList/cancelDebt/:debtId
router.delete("/cancelDebt/:debtId",validate(debtCancelSchema),authRole(role.CUSTOMER),async function(req,res,next){
    try {
        const _debtId = +req.params.debtId || 0;
        const _userId = +req.body.user_id || 0;
        const messageCancel = req.body.debt_cancel_message || '';
        const objDebt = await debtListModel.getDebtById(_debtId);
        if (objDebt != null){
            //if cancel your debt
            if (_userId === objDebt.user_id)
            {
                const recipientId = _userId; //send to yourself
                const transactionId = objDebt.paid_transaction_id
                let newNotify = {
                    user_id: recipientId,
                    transaction_id: transactionId,
                    debt_id: _debtId,
                    notification_message: messageCancel,
                    is_seen: 0
                };
                //add new notification
                notificationModel.genericMethods.add(newNotify);
            }
            else{
                //if cancel debt of another
                const userAccountNumber = objDebt.debt_account_number;
                const recipientBanking = await bankingAccountModel.genericMethods.findById(userAccountNumber);
                const recipientId = recipientBanking.length > 0 ? recipientBanking[0].user_id : 0; //send to yourself
                const transactionId = objDebt.paid_transaction_id;
                let newNotify = {
                    user_id: recipientId,
                    transaction_id: transactionId,
                    debt_id: _debtId,
                    notification_message: messageCancel,
                    is_seen: 0
                };
                //add new notification
                notificationModel.genericMethods.add(newNotify);
            }
            const result = debtListModel.updateStatusDebtPayment(_debtId,debt_status.CANCEL);

            res.status(200).json({
                isSuccess: true,
                message: "Cancel successful"
            })
        }
        else{
            res.status(500).json({
                isSuccess: false,
                message: "Could not find this debt",
            })
        }

    }catch (err){
        res.status(400).json({
            isSuccess: false,
            message: err.message
        })
    }
})


export default router;