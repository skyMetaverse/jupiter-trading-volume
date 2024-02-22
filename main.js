require('dotenv').config();
const bs58 = require("bs58");
const { Wallet } = require("@project-serum/anchor");
const { createJupiterApiClient, IndexedRouteMapResponse } = require("@jup-ag/api");
const { Connection, Keypair, VersionedTransaction, PublicKey } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token")

let SOL = "So11111111111111111111111111111111111111112";
let USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";


let SOL_Decimals = 10 ** 9;
let USDC_Decimals = 10 ** 6;
let SOL_AMOUNT = process.env.SOL_AMOUNT;
let USDC_AMOUNT = process.env.USDC_AMOUNT;
let address = new PublicKey(process.env.ADDRESS);
let connection = new Connection(process.env.SOLANA_RPC);
let wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY)));


let solAmount = SOL_Decimals * SOL_AMOUNT;
let usdcAmount = USDC_Decimals * USDC_AMOUNT;
let targetVolume = process.env.TARGET_VOLUME;
let jupiterQuoteApi = createJupiterApiClient();

let volume = 0;

let getUsdcBalance = async () => {
    console.log(`正在检查USDC余额...`);
    try {
        let tokenAccounts = await connection.getParsedTokenAccountsByOwner(address, {
            programId: TOKEN_PROGRAM_ID,
        });
        let usdcAccount = tokenAccounts.value.find(account => account.account.data.parsed.info.mint === USDC);
        // console.log(usdcAccount.account.data.parsed.info.tokenAmount.uiAmount);
        console.log(`USDC余额为: ${usdcAccount.account.data.parsed.info.tokenAmount.uiAmount}`);
        return usdcAccount.account.data.parsed.info.tokenAmount.uiAmount;
    } catch (err) {
        console.log(err);
    };
};

let getQuote = async (tokenIn, tokenOut, amount) => {
    try {
        let quote = await jupiterQuoteApi.quoteGet({
            inputMint: tokenIn,
            outputMint: tokenOut,
            amount: amount,
            slippageBps: 30,
            onlyDirectRoutes: false,
            asLegacyTransaction: false,
        });
        return quote;
    } catch (err) {
        console.log(err);
    };
};

let getSwapResult = async (quote) => {
    try {
        let swapResult = await jupiterQuoteApi.swapPost({
            swapRequest: {
                quoteResponse: quote,
                userPublicKey: wallet.publicKey.toBase58(),
                dynamicComputeUnitLimit: true,
            },
        });
        return swapResult;
    } catch (err) {
        console.log(err);
    };
};

let sellSol = async () => {
    try {
        let quote = await getQuote(SOL, USDC, solAmount);
        console.log(`正在将${solAmount / SOL_Decimals} SOL swap ${quote.outAmount / USDC_Decimals} USDC`);
        if (quote) {
            let swapResult = await getSwapResult(quote);
            if (swapResult) {
                let swapTransactionBuf = Buffer.from(swapResult.swapTransaction, "base64");
                let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
                transaction.sign([wallet.payer]);
                let rawTransaction = transaction.serialize();
                let txid = await connection.sendRawTransaction(rawTransaction, {
                    skipPreflight: true,
                    maxRetries: 20,
                });
                await connection.confirmTransaction(txid);
                console.log(`swap success: https://solscan.io/tx/${txid}`);
                volume += parseFloat(SOL_AMOUNT * 100);
            };
        };
    } catch (err) {
        console.log(err);
    };
};


let buySol = async (usdcBalance) => {
    try {
        let quote = await getQuote(USDC, SOL, usdcBalance * USDC_Decimals);
        console.log(`正在将${usdcBalance} USDC swap ${quote.outAmount / SOL_Decimals} SOL`);
        if (quote) {
            let swapResult = await getSwapResult(quote);
            if (swapResult) {
                let swapTransactionBuf = Buffer.from(swapResult.swapTransaction, "base64");
                let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
                transaction.sign([wallet.payer]);
                let rawTransaction = transaction.serialize();
                let txid = await connection.sendRawTransaction(rawTransaction, {
                    skipPreflight: true,
                    maxRetries: 20,
                });
                await connection.confirmTransaction(txid);
                console.log(`swap success: https://solscan.io/tx/${txid}`);
                volume += parseFloat(usdcBalance);
            };
        };
    } catch (err) {
        console.log(err);
    };
};

let run = async () => {
    while (1) {
        try {
            if (volume > targetVolume) {
                console.log(`已经刷够交易量, 停止交易 - 当前交易量: ${volume} - 目标交易量: ${targetVolume}`);
            };
            console.log(`当前交易量: ${volume} - 目标交易量: ${targetVolume}`);
            console.log(`正在检查SOL余额...`);
            let solBalance = await connection.getBalance(address);
            console.log(`SOL余额为: ${solBalance / SOL_Decimals}`);

            if (solBalance < parseInt(solAmount)) {
                let usdcBalance = await getUsdcBalance();
                if (usdcBalance > 0.0) {
                    await buySol(usdcBalance);
                };
            } else {
                if (solBalance > parseInt(solAmount)) {
                    await sellSol();
                };
            };
            console.log(`等待10s后继续swap...`);
            await sleep(1000 * 10);
        } catch (err) {
            console.log(err);
        };
    };
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let main = async () => {
    await run();
};
main();