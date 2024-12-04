const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Xvfb = require('xvfb');
puppeteer.use(StealthPlugin());

class Scraper {
    constructor() {
        this.browserLength = 0;
        this.browserLimit = process.env.browserLimit || 100;
        this.timeOut = process.env.timeOut || 120000;
    }

    async checkStat(page) {
        return new Promise(async (resolve) => {
            const st = setTimeout(() => {
                clearTimeout(st);
                resolve(false);
            }, 4000);

            try {
                const elements = await page.$$('[name="cf-turnstile-response"]');
                if (elements.length === 0) {
                    const coordinates = await page.evaluate(() => {
                        const coords = [];
                        document.querySelectorAll('div').forEach(item => {
                            try {
                                const itemCoordinates = item.getBoundingClientRect();
                                const itemCss = window.getComputedStyle(item);
                                if (itemCss.margin === "0px" && itemCss.padding === "0px" && itemCoordinates.width > 290 && itemCoordinates.width <= 310 && !item.querySelector('*')) {
                                    coords.push({ x: itemCoordinates.x, y: itemCoordinates.y, w: itemCoordinates.width, h: itemCoordinates.height });
                                }
                            } catch (err) { }
                        });
                        return coords;
                    });

                    for (const item of coordinates) {
                        try {
                            const x = item.x + 30;
                            const y = item.y + item.h / 2;
                            await page.mouse.click(x, y);
                        } catch (err) { }
                    }
                    return resolve(true);
                }

                for (const element of elements) {
                    try {
                        const parentElement = await element.evaluateHandle(el => el.parentElement);
                        const box = await parentElement.boundingBox();
                        const x = box.x + 30;
                        const y = box.y + box.height / 2;
                        await page.mouse.click(x, y);
                    } catch (err) { }
                }
                clearTimeout(st);
                resolve(true);
            } catch (err) {
                clearTimeout(st);
                resolve(false);
            }
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async browserCreator({ proxy = {}, agent = null }) {
        try {
            let solve_status = true;

            const setSolveStatus = (status) => {
                solve_status = status;
            };

            const autoSolve = async (page) => {
                while (solve_status) {
                    try {
                        await this.sleep(1500);
                        await this.checkStat(page).catch(() => { });
                    } catch (err) { }
                }
            };

            setSolveStatus(true);
            let xvfbsession;
            try {
                xvfbsession = new Xvfb({
                    silent: true,
                    xvfb_args: ['-screen', '0', '1920x1080x24', '-ac']
                });
                xvfbsession.startSync();
            } catch (err) { }

            const browser = await puppeteer.launch({
                headless: false,
                executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--no-zygote',
                    '--no-first-run',
                    '--mute-audio',
                    '--disable-notifications',
                    proxy.host && proxy.port ? `--proxy-server=${proxy.host}:${proxy.port}` : "",
                ],
                ignoreHTTPSErrors: true,
                targetFilter: target => !!target.url(),
            });

            let [page] = await browser.pages();
            if (proxy.username && proxy.password) await page.authenticate({ username: proxy.username, password: proxy.password });
            if (agent) await page.setUserAgent(agent);

            browser.on('disconnected', async () => {
                try { xvfbsession.stopSync(); } catch (err) { }
                setSolveStatus(false);
            });

            autoSolve(page);
            return { page, browser };

        } catch (err) {
            console.log(err.message);
            return false;
        }
    }

    checkTimeOut(startTime, endTime = Date.now()) {
        return (endTime - startTime) > this.timeOut;
    }

    formatLanguage(languages) {
        let str = '';
        if (languages[0]) str += `${languages[0]},${languages[1]};q=0.9`;
        if (languages[2]) str += `,${languages[2]};q=0.8`;
        if (languages[3]) str += `,${languages[3]};q=0.7`;
        return str;
    }

    async scrape({ proxy = {}, agent = null, url = null, defaultCookies = false, mode = null }) {
        return new Promise(async (resolve) => {
            this.browserLength++;
            let brw = null;
            const startTime = Date.now();
            let headers = {};
    
            try {
                setTimeout(() => {
                    this.browserLength--;
                    try { brw.close(); } catch (err) { }
                    resolve({ code: 500, message: 'Request Timeout' });
                }, this.timeOut);
    
                const { page, browser } = await this.browserCreator({ proxy, agent });
                brw = browser;
    
                if (defaultCookies) await page.setCookie(...defaultCookies);
    
                const browserLanguages = await page.evaluate(() => navigator.languages);
                headers['accept-language'] = this.formatLanguage(browserLanguages);
    
                await page.setExtraHTTPHeaders({ 'accept-language': headers['accept-language'] });
    
                if (!agent) agent = await page.evaluate(() => navigator.userAgent);
    
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    if (['stylesheet', 'font', 'image', 'media'].includes(request.resourceType())) {
                        request.abort();
                    } else {
                        request.continue();
                        if (request.url() === url) {
                            const reqHeaders = request.headers();
                            delete reqHeaders['cookie'];
                            headers = { ...headers, ...reqHeaders, host: new URL(url).hostname };
                        }
                    }
                });
    
                page.on('response', async (response) => {
                    if (response.url().includes('/verify/turnstile') && mode === 'captcha') {
                        try {
                            const responseBody = await response.json();
                            if (responseBody && responseBody.token) {
                                const cookies = await page.cookies();
                                this.browserLength--;
                                try { browser.close(); } catch (err) { }
                                resolve({ code: 200, cookies, agent, proxy, url, headers, turnstile: responseBody });
                            }
                        } catch (err) { }
                    } else if (mode === 'captcha') {
                        const checkToken = await page.evaluate(() => {
                            const cfItem = document.querySelector('[name="cf-turnstile-response"]');
                            return cfItem && cfItem.value && cfItem.value.length > 0 ? cfItem.value : false;
                        }).catch(() => false);
                        if (checkToken) {
                            const cookies = await page.cookies();
                            this.browserLength--;
                            try { browser.close(); } catch (err) { }
                            resolve({ code: 200, cookies, agent, proxy, url, headers, turnstile: { token: checkToken } });
                        }
                    }
                });
                await page.goto(url, { waitUntil: ['load', 'networkidle0'], timeout: this.timeOut });
    
                if (mode === 'captcha') return;
    
                let cookies = false;
                while (!cookies) {
                    try {
                        cookies = await page.cookies();
                        if (!cookies.find(cookie => cookie.name === 'cf_clearance')) cookies = false;
                    } catch (err) { cookies = false; }
                    await this.sleep(50);
                    if (this.checkTimeOut(startTime)) {
                        await browser.close();
                        this.browserLength--;
                        resolve({ code: 500, message: 'Request Timeout' });
                    }
                }
    
                headers['cookie'] = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
                await browser.close();
                this.browserLength--;
                resolve({ code: 200, cookies, agent, proxy, url, headers });
            } catch (err) {
                this.browserLength--;
                try { brw.close(); } catch (err) { }
                resolve({ code: 500, message: err.message });
            }
        });
    }
}

module.exports = new Scraper();