const https = require('https');

async function checkApiKey() {
    return new Promise((resolve) => {
        https.get('https://gmgn.ai/api/v1/wallet_holdings/sol/AZ2hpSLkQu974wKD7Bxv7w9YZg399ZhBcboSLtRabq9v', {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        }, (res) => {
            console.log("Status:", res.statusCode);
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log(data.substring(0, 300));
                resolve();
            });
        }).on('error', (e) => {
            console.log(e.message);
            resolve();
        });
    });
}
checkApiKey();
