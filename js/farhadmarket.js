'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ArgumentsRequired } = require ('./base/errors');
const { PAD_WITH_ZERO } = require ('./base/functions/number');

//  ---------------------------------------------------------------------------

module.exports = class farhadmarket extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'farhadmarket',
            'name': 'FarhadMarket',
            'countries': [ 'IR' ],
            'rateLimit': 500,
            'has': {
                'cancelOrder': true,
                'CORS': true,
                'createOrder': true,
                'fetchCurrencies': true,
                'fetchBalance': true,
                'fetchClosedOrders': true,
                'fetchDepositAddress': false, // TODO
                'fetchDeposits': false, // TODO
                'fetchFundingFees': false, // TODO
                'fetchMarkets': true,
                'fetchMyTrades': true,
                'fetchOHLCV': true,
                'fetchOpenOrders': true,
                'fetchOrder': true,
                'fetchOrders': true,
                'fetchOrderBook': true,
                'fetchTicker': true,
                'fetchTickers': true,
                'fetchTime': false, // TODO
                'fetchTrades': true,
                'fetchTradingFee': false, // TODO
                'fetchTradingFees': false, // TODO
                'fetchTransactions': false, // TODO
                'fetchWithdrawals': false, // TODO
            },
            'timeframes': {
                '1m': '60',
                '3m': '180',
                '5m': '300',
                '15m': '900',
                '30m': '1800',
                '1h': '3600',
                '2h': '7200',
                '4h': '14400',
                '6h': '21600',
                '12h': '43200',
                '1d': '86400',
                '3d': '259200',
                '1w': '604800',
                '1M': '2592000',
            },
            'urls': {
                'test': 'https://testnet.farhadmarket.com',
                'logo': 'https://app.farhadmarket.com/static/media/logo4-white-cropped.b484afd7.png',
                'api': 'https://api.farhadmarket.com/apiv2',
                'www': 'https://app.farhadmarket.com',
                'doc': 'https://apidocs.farhadmarket.com/',
                'api_management': 'https://app.farhadmarket.com/api',
                'fees': 'https://farhadmarket.com/fees',
            },
            'api': {
                'public': {
                    'get': [
                        'currencies',
                        'markets',
                    ],
                    'depth': [ 'markets/{symbol}' ],
                    'kline': [ 'markets/{symbol}' ],
                    'peek': [ 'markets/{symbol}/marketdeals' ],
                },
                'private': {
                    'get': [
                        'orders',
                        'orders/{id}',
                    ],
                    'overview': [ 'balances' ],
                    'cancel': [ 'orders/{id}' ],
                    'create': [ 'orders' ],
                    'peek': [ 'markets/{symbol}/mydeals' ],
                },
            },
            'fees': { // TODO
                'trading': {
                    'feeSide': 'get',
                    'tierBased': false,
                    'percentage': true,
                    'taker': 0.004, // TODO
                    'maker': 0.001, // TODO
                },
            },
            'paddingMode': PAD_WITH_ZERO,
        });
    }

    currencyToPrecision (currency, fee) {
        return this.numberToString (fee);
    }

    async fetchTime (params = {}) {
        const type = this.safeString2 (this.options, 'fetchTime', 'defaultType', 'spot');
        let method = 'publicGetTime';
        if (type === 'future') {
            method = 'fapiPublicGetTime';
        } else if (type === 'delivery') {
            method = 'dapiPublicGetTime';
        }
        const response = await this[method] (params);
        return this.safeInteger (response, 'serverTime');
    }

    async fetchCurrencies (params = {}) {
        const response = await this.publicGetCurrencies (params);
        const result = {};
        for (let i = 0; i < response.length; i++) {
            const entry = response[i];
            const id = this.safeString (entry, 'symbol');
            const name = this.safeString (entry, 'name');
            const code = this.safeCurrencyCode (id);
            const precision = -this.safeInteger (entry, 'smallestUnitScale');
            let isWithdrawEnabled = true;
            let isDepositEnabled = true;
            const networkList = this.safeValue (entry, 'networks', []);
            const fees = {};
            let fee = undefined;
            let primaryNetworkOrder = undefined;
            for (let j = 0; j < networkList.length; j++) {
                const networkItem = networkList[j];
                const network = this.safeString (networkItem, 'chain');
                // const name = this.safeString (networkItem, 'name');
                const withdrawFee = this.safeNumber (networkItem, 'withdrawStaticCommission');
                const depositEnable = this.safeValue (networkItem, 'isDepositable');
                const withdrawEnable = this.safeValue (networkItem, 'isWithdrawable');
                isDepositEnabled = isDepositEnabled || depositEnable;
                isWithdrawEnabled = isWithdrawEnabled || withdrawEnable;
                fees[network] = withdrawFee;
                const order = this.safeInteger (networkItem, 'order');
                if (order < primaryNetworkOrder) {
                    primaryNetworkOrder = order;
                }
                const isDefault = primaryNetworkOrder === order;
                if (isDefault || fee === undefined) {
                    fee = withdrawFee;
                }
            }
            const active = (isWithdrawEnabled && isDepositEnabled);
            result[code] = {
                'id': id,
                'name': name,
                'code': code,
                'precision': precision,
                'info': entry,
                'active': active,
                'fee': fee,
                'fees': fees,
                'limits': this.limits,
            };
        }
        return result;
    }

    async fetchMarkets (params = {}) {
        const currencies = await this.fetchCurrencies ();
        const currenciesById = this.indexBy (currencies, 'id');
        const response = await this.publicGetMarkets (params);
        const result = [];
        for (let i = 0; i < response.length; i++) {
            const market = response[i];
            const id = this.safeString (market, 'name');
            const baseId = this.safeString (market, 'baseCurrencySymbol');
            const quoteId = this.safeString (market, 'quoteCurrencySymbol');
            const baseCurrency = this.safeValue (currenciesById, baseId, {});
            const quoteCurrency = this.safeValue (currenciesById, quoteId, {});
            const symbol = baseId + '/' + quoteId;
            const active = true;
            const maxAmount = this.safeNumber (market, 'maxAmount');
            const minAmount = this.safeNumber (market, 'minAmount');
            const fee = this.parseTradingFee (market);
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': baseCurrency,
                'quote': quoteCurrency,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': active,
                'info': market,
                'taker': fee['taker'],
                'maker': fee['maker'],
                'precision': {
                    'price': quoteCurrency.precision,
                    'amount': baseCurrency.precision,
                    'cost': quoteCurrency.precision,
                },
                'limits': {
                    'amount': {
                        'min': minAmount,
                        'max': maxAmount,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                },
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        const response = await this.privateOverviewBalances (params);
        const result = { 'info': response };
        const codes = Object.keys (this.currencies);
        for (let i = 0; i < codes.length; i++) {
            const balance = response[i];
            const symbol = this.safeCurrencyCode (this.safeString (balance, 'name'));
            const account = this.account ();
            const freeze = this.safeNumber (balance, 'freeze');
            const available = this.safeNumber (balance, 'available');
            account['free'] = available;
            account['total'] = available + freeze;
            account['used'] = freeze;
            result[symbol] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
            'interval': '0',
        };
        if (limit !== undefined) {
            request['limit'] = limit; // max 100
        }
        const response = await this.publicDepthMarketsSymbol (this.extend (request, params));
        const timestamp = this.seconds ();
        return this.parseOrderBook (response, timestamp, 'bids', 'asks', 'price', 'amount');
    }

    parseTicker (ticker, market = undefined) {
        //
        //     {
        //         symbol: 'ETHBTC',
        //         priceChange: '0.00068700',
        //         priceChangePercent: '2.075',
        //         weightedAvgPrice: '0.03342681',
        //         prevClosePrice: '0.03310300',
        //         lastPrice: '0.03378900',
        //         lastQty: '0.07700000',
        //         bidPrice: '0.03378900',
        //         bidQty: '7.16800000',
        //         askPrice: '0.03379000',
        //         askQty: '24.00000000',
        //         openPrice: '0.03310200',
        //         highPrice: '0.03388900',
        //         lowPrice: '0.03306900',
        //         volume: '205478.41000000',
        //         quoteVolume: '6868.48826294',
        //         openTime: 1601469986932,
        //         closeTime: 1601556386932,
        //         firstId: 196098772,
        //         lastId: 196186315,
        //         count: 87544
        //     }
        //
        const timestamp = this.safeInteger (ticker, 'closeTime');
        const marketId = this.safeString (ticker, 'symbol');
        const symbol = this.safeSymbol (marketId, market);
        const last = this.safeNumber (ticker, 'lastPrice');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeNumber (ticker, 'highPrice'),
            'low': this.safeNumber (ticker, 'lowPrice'),
            'bid': this.safeNumber (ticker, 'bidPrice'),
            'bidVolume': this.safeNumber (ticker, 'bidQty'),
            'ask': this.safeNumber (ticker, 'askPrice'),
            'askVolume': this.safeNumber (ticker, 'askQty'),
            'vwap': this.safeNumber (ticker, 'weightedAvgPrice'),
            'open': this.safeNumber (ticker, 'openPrice'),
            'close': last,
            'last': last,
            'previousClose': this.safeNumber (ticker, 'prevClosePrice'), // previous day close
            'change': this.safeNumber (ticker, 'priceChange'),
            'percentage': this.safeNumber (ticker, 'priceChangePercent'),
            'average': undefined,
            'baseVolume': this.safeNumber (ticker, 'volume'),
            'quoteVolume': this.safeNumber (ticker, 'quoteVolume'),
            'info': ticker,
        };
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        let method = 'publicGetTicker24hr';
        if (market['future']) {
            method = 'fapiPublicGetTicker24hr';
        } else if (market['delivery']) {
            method = 'dapiPublicGetTicker24hr';
        }
        const response = await this[method] (this.extend (request, params));
        if (Array.isArray (response)) {
            const firstTicker = this.safeValue (response, 0, {});
            return this.parseTicker (firstTicker, market);
        }
        return this.parseTicker (response, market);
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        const defaultType = this.safeString2 (this.options, 'fetchTickers', 'defaultType', 'spot');
        const type = this.safeString (params, 'type', defaultType);
        const query = this.omit (params, 'type');
        let defaultMethod = undefined;
        if (type === 'future') {
            defaultMethod = 'fapiPublicGetTicker24hr';
        } else if (type === 'delivery') {
            defaultMethod = 'dapiPublicGetTicker24hr';
        } else {
            defaultMethod = 'publicGetTicker24hr';
        }
        const method = this.safeString (this.options, 'fetchTickersMethod', defaultMethod);
        const response = await this[method] (query);
        return this.parseTickers (response, symbols);
    }

    parseOHLCV (ohlcv, market = undefined) {
        return [
            this.safeInteger (ohlcv, 'time') * 1000,
            this.safeNumber (ohlcv, 'o'),
            this.safeNumber (ohlcv, 'h'),
            this.safeNumber (ohlcv, 'l'),
            this.safeNumber (ohlcv, 'c'),
            this.safeNumber (ohlcv, 'volume'),
        ];
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const duration = this.parseTimeframe (timeframe);
        const request = {
            'symbol': market['id'],
            'interval': duration,
        };
        if (limit === undefined) {
            limit = 100;
        }
        if (since === undefined) {
            since = this.milliseconds () - duration * limit * 1000;
        }
        const start = parseInt (since / 1000);
        request['start'] = start;
        request['end'] = this.sum (start, limit * duration);
        const response = await this.publicKlineMarketsSymbol (this.extend (request, params));
        return this.parseOHLCVs (response, market, timeframe, since, limit);
    }

    parseTrade (trade, market = undefined) {
        const timestamp = this.parse8601 (this.safeString (trade, 'time'));
        const id = this.safeInteger (trade, 'id');
        const price = this.safeNumber (trade, 'price');
        const amount = this.safeNumber (trade, 'amount');
        const role = this.safeString (trade, 'role');
        const side = this.safeString (trade, 'side');
        const cost = this.safeNumber (trade, 'deal');
        const fee = this.safeNumber (trade, 'fee');
        const orderId = this.safeInteger (trade, 'orderId');
        const symbol = market['symbol'];
        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': undefined,
            'side': side,
            'order': orderId,
            'takerOrMaker': role,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': fee,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
            'limit': 20,
            'lastId': 0,
        };
        // TODO: Use `since` parameter
        const response = await this.publicPeekMarketsSymbolMarketdeals (this.extend (request, params));
        return this.parseTrades (response, market, since, limit);
    }

    parseOrder (order, market = undefined) {
        const timestamp = this.parse8601 (this.safeString (order, 'createdAt'));
        const finished = (this.safeValue (order, 'finishedAt') !== undefined);
        const filled = this.safeNumber (order, 'filledStock');
        const amount = this.safeNumber (order, 'amount');
        let status = 'open';
        if (filled === amount) {
            status = 'closed';
        } else if (finished) {
            status = 'canceled';
        }
        const marketId = this.safeString (order, 'market');
        const symbol = this.safeSymbol (marketId, market);
        return {
            'id': this.safeString (order, 'id'),
            'clientOrderId': undefined,
            'timestamp': timestamp, // until they fix their timestamp
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'status': status,
            'symbol': symbol,
            'type': this.safeString (order, 'type'),
            'timeInForce': undefined,
            'postOnly': undefined,
            'side': this.safeString (order, 'side'),
            'price': this.safeNumber (order, 'price'),
            'stopPrice': undefined,
            'amount': amount,
            'filled': filled,
            'remaining': undefined,
            'trades': undefined,
            'info': order,
            'cost': undefined,
            'average': undefined,
            'fee': undefined,
        };
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'marketName': this.marketId (symbol),
            'type': type,
            'side': side,
            'amount': this.amountToPrecision (symbol, amount),
        };
        if (type === 'limit') {
            request['price'] = this.priceToPrecision (symbol, price);
        } else if (type === 'market') {
            if (side === 'buy') {
                request['isAmountAsQuote'] = false; // TODO
            }
        }
        const response = await this.privateCreateOrders (this.extend (request, params));
        return this.parseOrder (response, market);
    }

    async fetchClosedOrder (id, symbol = undefined, params = {}) {
        const request = { 'status': 'finished' };
        return await this.fetchOrder (id, symbol, this.extend (request, params));
    }

    async fetchOpenOrder (id, symbol = undefined, params = {}) {
        const request = { 'status': 'pending' };
        return await this.fetchOrder (id, symbol, this.extend (request, params));
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrder() requires a symbol argument');
        }
        this.checkRequiredCredentials ();
        await this.loadMarkets ();
        const market = this.market (symbol);
        const status = this.safeString (params, 'status', 'pending'); // TODO
        const request = {
            'id': id,
            'status': status,
            'marketName': market['id'],
        };
        const response = await this.privateGetOrdersId (request);
        return this.parseOrder (response, market);
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrder() requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const status = this.safeString (params, 'status', 'pending'); // TODO
        const request = {
            'marketName': market['id'],
            'status': status,
            'limit': 20,
        };
        // TODO: Use `since` parameter
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privateGetOrders (request);
        return this.parseOrders (response, market, since, limit);
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = { 'status': 'pending' };
        return await this.fetchOrders (symbol, since, limit, this.extend (request, params));
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = { 'status': 'finished' };
        return await this.fetchOrders (symbol, since, limit, this.extend (request, params));
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelOrder() requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'id': id,
            'marketName': market['id'],
        };
        const response = await this.privateCancelOrdersId (this.extend (request, params));
        return this.parseOrder (response);
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchMyTrades() requires a symbol argument');
        }
        this.checkRequiredCredentials ();
        await this.loadMarkets ();
        const market = this.market (symbol);
        params = this.omit (params, 'type');
        const request = {
            'symbol': market['id'],
            'offset': 0,
            'limit': 20,
        };
        // TODO: Use `since` parameter
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privatePeekMarketsSymbolMydeals (this.extend (request, params));
        return this.parseTrades (response, market, since, limit);
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + this.implodeParams (path, params);
        const query = this.omit (params, this.extractParams (path));
        if (api === 'private') {
            this.checkRequiredCredentials ();
            headers = {
                'X-API-KEY': this.apiKey,
                'X-API-SECRET': this.secret,
                'Content-Type': 'application/x-www-form-urlencoded',
            };
        }
        if (method === 'CREATE') {
            body = this.urlencode (query);
        } else {
            if (Object.keys (query).length) {
                url += '?' + this.urlencode (query);
            }
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }
};
