 const WebSocket = require('ws');
const Reader = require("./Reader");
const Writer = require("./Writer");
const Scraper = require("../../cf_bypass");
const Helper = require("./Helper");
const { HttpsProxyAgent } = require("https-proxy-agent");
const Logger = require("./Logger");
const config = require("../config/config");
const fs = require('fs');


let server = null;
let startedBots = false;
let stoppingBots = true;

let proxies = loadProxies();



function loadProxies() {
  const proxies = fs
    .readFileSync("proxies.txt", "utf-8")
    .split("\n")
    .map((proxy) => proxy.trim())
    .filter((proxy) => proxy.length > 0);
  console.log(`Proxies reloaded: ${proxies.length} proxies`);
  return proxies;
}


class Module {
    constructor(ws) {
        this.ws = ws;
        this.bots = [];
        this.botInt = null;
        this.aliveBots = 0;
    }
	async solveturnstile() {
		try {
			// Dynamically import the p-limit module
			const { default: pLimit } = await import('p-limit');
	
			// Create a limit function to only allow 5 concurrent tasks at a time
			const limit = pLimit(3);
	
			// Create an array of promises to handle the proxies in parallel with concurrency limit
			const proxyPromises = proxies.map((proxy) => {
				return limit(async () => {
					const proxyParts = proxy.split(":");
					const host = proxyParts[0];
					const port = proxyParts[1];
					const username = proxyParts[2];
					const password = proxyParts[3];
	
					try {
						// Attempt to bypass Cloudflare using this proxy
						const result = await Scraper.scrape({
							proxy: {
								host: host,
								port: port,
								username: username,
								password: password
							},
							agent: undefined,
							url: 'https://gota.io/web',
							defaultCookies: undefined,
							mode: 'waf',
						});
	
						// Check result and log the appropriate message
						if (result.code === 200) {
							console.log(`[SUCCESS]: Bypassed Cloudflare with proxy [${host}:${port}:${username}:${password}] | Status Code: ${result.code}`);
						} else {
							console.log(`[ERROR]: Failed bypassing Cloudflare with proxy [${host}:${port}:${username}:${password}] | Status Code: ${result.code}, Message: ${result.message}`);
						}
					} catch (err) {
						// Log any error that occurs while processing this proxy
						console.error(`[ERROR]: Error processing proxy [${host}:${port}:${username}:${password}]`, err);
					}
				});
			});
	
			// Wait for all proxy requests to complete with concurrency control
			await Promise.all(proxyPromises);
	
			console.log('Proxy bypass attempts completed for all proxies.');
	
		} catch (err) {
			console.error('[ERROR]: An error occurred during the multithreaded proxy iteration:', err);
			return { code: 500, message: 'Error bypassing Cloudflare' };
		}
	}

    async handleMessage(buffer) {
        const reader = new Reader(buffer);
        const opcode = reader.readUint8();
        switch (opcode) {
            case 0:
                server = reader.readString();
                break;
            case 1:
                this.startBots();
                break;
            case 2:
                this.stopBots();
                break;
            case 3:
                this.handleSplitBots();
                break;
            case 4:
                this.handleFeedBots();
                break;
            case 5:
                this.handleMouse(reader);
                break;
            case 6:
                this.handleSendCaptcha(reader);
                break;
            case 7:
                await Helper.initializeProxies();
                this.ws.send(Buffer.from([4]));
                break;
        }
    }
    startBots() {
        if (!startedBots) {
            stoppingBots = false;
            for (let i = 0; i < config.botsAmount; i++) this.bots.push(new NELBOTS(i, this.ws));
            this.botInt = setInterval(() => { this.updateAliveBots(); }, 50);
            Logger.info(`User Starting bots`);
        }
    }
    stopBots() {
        if (startedBots && !stoppingBots) {
            clearInterval(this.botInt);
            this.bots.forEach(bot => bot.stop());
            this.bots = [];
            this.botInt = null;
            server = null;
            startedBots = false;
            stoppingBots = true;
            this.ws.send(Buffer.from([1])); 
            Logger.warn(`Bots Stopped!`);
        }
    }
    handleSplitBots() {
        for (const bot of this.bots) {
            if (bot.ws && !stoppingBots) {
                bot.split();
                let ejectCount = 3;
                let ejectInterval = setInterval(() => {
                    if (ejectCount > 0) {
                        bot.eject();
                        ejectCount--;
                    } else {
                        clearInterval(ejectInterval);
                    }
                }, 100);
            }
        }
    }
    handleFeedBots() {
        for (const bot of this.bots) if (bot.ws && !stoppingBots) bot.eject();
    }
    handleMouse(reader) {
        const mouseX = reader.readInt32();
        const mouseY = reader.readInt32();
        for (const bot of this.bots) bot.playerPos = { x: mouseX, y: mouseY };
    }
    handleSendCaptcha(reader) {
        const id = reader.readUint8();
        const token = reader.readString();
        if (this.bots[id] && this.bots[id].ws) this.bots[id].sendCaptcha(token);
    }
    sendBotsCount(spawnedBots, botsAmount) {
        const writer = new Writer(5);
        writer.writeUint8(2);
        writer.writeUint16(spawnedBots); 
        writer.writeUint16(botsAmount);
        this.ws.send(writer.buffer);
    }
    updateAliveBots() {
        const maxBots = config.botsAmount;
        this.aliveBots = this.bots.filter(bot => bot.ws?.readyState === WebSocket.OPEN && bot.isAlive).length;
        if (this.aliveBots > maxBots) this.aliveBots = maxBots;
        this.sendBotsCount(this.aliveBots, maxBots);
    }
}

class NELBOTS {
	constructor(id, userWS) {
		this.ws = null;
		this.id = id;
		this.userWS = userWS;
		this.isAlive = false;
		this.moveInt = null;
		this.spawnInt = null;
		this.isReconnecting = false;
		this.reconnectTimeout = null;
		this.playerPos = { x: 0, y: 0 };
		this.version = "Gota Web " + "3.6.5";
		this.agent = this.proxyAgent,
		this.headers = Helper.generateHeaders(new URL(server).host);
		this.connect();
	}
	connect() {

		this.proxy = proxies[Math.floor(Math.random() * proxies.length)];

// Split the proxy string into components
const proxyParts = this.proxy.split(":");
const host = proxyParts[0];
const port = proxyParts[1];
const username = proxyParts[2];
const password = proxyParts[3];

    const proxyUrl = `http://${username}:${password}@${host}:${port}`;
    this.proxyAgent = new HttpsProxyAgent(proxyUrl);
		
		this.requestCaptchaToken();
		this.ws = new WebSocket(server, {
			agent: this.proxyAgent,
			headers: {
                "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                'Origin': 'https://gota.io',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                "Pragma": "no-cache",
                "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
                "Sec-WebSocket-Version": "13",
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            },
			rejectUnauthorized: false,
			
		});
		this.ws.binaryType = "arraybuffer";
		this.ws.onopen = this.onopen.bind(this);
		this.ws.onclose = this.onclose.bind(this);
		this.ws.onerror = this.onerror.bind(this);
		this.ws.onmessage = this.onmessage.bind(this);
	}
	onopen() {
		this.protocolVersion();
		this.sendPing();
		this.secondaryInits();
		this.spawnInt = setInterval(() => {
			this.spawn();
		}, 1000);
		this.pingInt = setInterval(() => {
			this.sendPing();
		}, 3e4);
		this.moveInt = setInterval(() => {
			this.moveTo(this.playerPos);
		}, 100);
	}
	onclose() {
		this.clearIntervals();
		this.handleReconnection();
	}
	onerror() {
		this.handleReconnection();
	}
	onmessage(message) {
		const buffer = Buffer.from(message.data);
		const reader = new Reader(buffer);
		const opcode = reader.readUint8();
		switch (opcode) {
			case 2:
				try {
					this.handleUpdate(reader);
				} catch (error) {
					Logger.debug(error);
				}
				break;
			case 40:
				this.sendInviteResponse()
				break;
		}
	}
	send(message) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message);
	}
	handleUpdate(reader) {
		let numberOfReads = reader.readUint16();
		while (numberOfReads > 0) {
			reader.readUint16();
			numberOfReads--;
		}
		numberOfReads = reader.readUint16();
		while (numberOfReads > 0) {
			reader.readUint16();
			numberOfReads--;
		}
		while (true) {
			const cellId = reader.readUint16();
			if (cellId === 0) break;
			reader.readUint8(); 
			const flag = reader.readUint8();
			if ((flag & 2) === 2) {
				reader.readUint8();
				reader.readUint8();
			}
			if (!this.isAlive) {
				this.isAlive = true;
				if (!startedBots) {
					startedBots = true;
					this.userWS.send(Buffer.from([0]));
					Logger.info('Bots started');
				}
			}
		}
	
		while (true) {
			const type = reader.readUint8();
			let subActionCount = 0;
			if (type === 0) break;
			while (true) {
				if (type === 2 && subActionCount === 0) {
					subActionCount = reader.readUint16();
					if (subActionCount === 0) break;
				}
				const cellId = reader.readUint16();
				if (cellId === 0) {
					if (type === 2) {
						subActionCount = 0;
						continue;
					} else {
						break;
					}
				}
				reader.readInt16();
				reader.readInt16();
				switch (type) {
					case 1:
						reader.readUint16();
						reader.readUint8();
						reader.readUint8();
						reader.readUint8();
						reader.readUint8();
						break;
					case 2:
						reader.readUint16();
						break;
					case 3:
						reader.readUint16();
						break;
					case 4:
						reader.readUint16();
						break;
					case 5:
						reader.readUint16();
						reader.readUint8();
						break;
				}
			}
		}
		while (true) {
			const type = reader.readUint8();
			if (type === 0) break;
			while (true) {
				const cellId = reader.readUint16();
				if (cellId === 0) break;
				reader.readUint16();
				reader.readUint16();
				switch (type) {
					case 2:
						reader.readUint16();
						break;
					case 3:
						reader.readUint16();
						break;
					case 4:
						reader.readUint16();
						break;
				}
			}
		}
	}	
	requestCaptchaToken() {
		this.userWS.send(Buffer.from([3, this.id]));
	}
	protocolVersion() {
		const writer = new Writer(1 + this.version.length + 1 + 1);
		writer.writeUint8(255, 0);
		writer.writeUint8(6, 1);
		writer.writeString(this.version);
		this.send(writer.buffer);
	}
	sendPing() {
		const writer = new Writer(1);
		writer.writeUint8(71, 0);
		this.send(writer.buffer);
	}
	secondaryInits() {
		const writer = new Writer(3);
		writer.writeUint8(104, 0);
		writer.writeUint16(100, 1);
		this.send(writer.buffer);
	}
	sendInviteResponse() {
		const writer = new Writer(2);
		writer.writeUint8(41);
		writer.writeUint8(1);
		this.send(writer.buffer);
	}
	sendCaptcha(token) {
		const writer = new Writer(1 + (token.length + 1));
		writer.writeUint8(100);
		writer.writeString(token)
		this.send(writer.buffer);
	}
	spawn() {
    let nicks = [
      "dc: cloudyofficial",
      "cloudy is the best",
	    "cloudy too good",
	    "sasa",
	    "cloudyy",
	    "cloudyyy",
	    "cloudyofficial",
    ];
    const string = nicks[~~(Math.random() * nicks.length)];
		const writer = new Writer(2 + (string.length + 1) * 2);
		writer.writeUint8(0);
		writer.writeString16(string);
		writer.writeString16(0);
		this.send(writer.buffer);
	}
	moveTo({ x, y }) {
		const writer = new Writer(9);
		writer.writeUint8(16);
		writer.writeInt32(x + Math.random() * 5);
		writer.writeInt32(y + Math.random() * 10);
		this.send(writer.buffer);
	}
	split() {
		this.send(Buffer.from([17]))
	}
	eject() {
		this.send(Buffer.from([21]))
	}
	clearIntervals() {
		clearInterval(this.spawnInt);
		clearInterval(this.moveInt);
	}
	stop() {
		if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN)
		clearTimeout(this.reconnectTimeout);
		this.clearIntervals();
		this.ws.close();
		this.ws = null;
		this.isReconnecting = false;
	}
	handleReconnection() {
		if (server && !this.isReconnecting) {
			this.isReconnecting = true;
			this.reconnectTimeout = setTimeout(() => {
				this.isReconnecting = false;
				this.reconnect();
			}, 50);
		}
	}
	async reconnect() {
		try {
			this.connect();
		} catch (error) {
			Logger.debug(error)
		}
	}
}

module.exports = Module;
