'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, ArgumentsRequired, ExchangeNotAvailable, InsufficientFunds, OrderNotFound, InvalidOrder, DDoSProtection, InvalidNonce, AuthenticationError, RateLimitExceeded, PermissionDenied, NotSupported, BadRequest, BadSymbol, AccountSuspended, OrderImmediatelyFillable } = require ('./base/errors');
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
                'fetchClosedOrders': 'emulated',
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
        const response = await this.publicGetCurrencies(params);
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
                const order = this.safeInteger (networkItem, 'order')
                if (order < primaryNetworkOrder) {
                    primaryNetworkOrder = order
                }
                const isDefault = primaryNetworkOrder === order
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
        const currencies = await this.fetchCurrencies();
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
            const fee = this.parseTradingFee (market)
            result.push({
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
        const duration = this.parseTimeframe (timeframe)
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

        const finished = (this.safeValue (order, 'finishedAt') === undefined);
        const filled = this.safeNumber (order, 'filledStock');
        const amount = this.safeNumber (order, 'amount');
        let status = 'open';
        if (filled === amount) {
            status = 'closed'
        } else if (finished){
            status = 'canceled'
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

    async fetchOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrder() requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const defaultType = this.safeString2 (this.options, 'fetchOrder', 'defaultType', market['type']);
        const type = this.safeString (params, 'type', defaultType);
        let method = 'privateGetOrder';
        if (type === 'future') {
            method = 'fapiPrivateGetOrder';
        } else if (type === 'delivery') {
            method = 'dapiPrivateGetOrder';
        } else if (type === 'margin') {
            method = 'sapiGetMarginOrder';
        }
        const request = {
            'symbol': market['id'],
        };
        const clientOrderId = this.safeValue2 (params, 'origClientOrderId', 'clientOrderId');
        if (clientOrderId !== undefined) {
            request['origClientOrderId'] = clientOrderId;
        } else {
            request['orderId'] = id;
        }
        const query = this.omit (params, [ 'type', 'clientOrderId', 'origClientOrderId' ]);
        const response = await this[method] (this.extend (request, query));
        return this.parseOrder (response, market);
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrders() requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const defaultType = this.safeString2 (this.options, 'fetchOrders', 'defaultType', market['type']);
        const type = this.safeString (params, 'type', defaultType);
        let method = 'privateGetAllOrders';
        if (type === 'future') {
            method = 'fapiPrivateGetAllOrders';
        } else if (type === 'delivery') {
            method = 'dapiPrivateGetAllOrders';
        } else if (type === 'margin') {
            method = 'sapiGetMarginAllOrders';
        }
        const request = {
            'symbol': market['id'],
        };
        if (since !== undefined) {
            request['startTime'] = since;
        }
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const query = this.omit (params, 'type');
        const response = await this[method] (this.extend (request, query));
        //
        //  spot
        //
        //     [
        //         {
        //             "symbol": "LTCBTC",
        //             "orderId": 1,
        //             "clientOrderId": "myOrder1",
        //             "price": "0.1",
        //             "origQty": "1.0",
        //             "executedQty": "0.0",
        //             "cummulativeQuoteQty": "0.0",
        //             "status": "NEW",
        //             "timeInForce": "GTC",
        //             "type": "LIMIT",
        //             "side": "BUY",
        //             "stopPrice": "0.0",
        //             "icebergQty": "0.0",
        //             "time": 1499827319559,
        //             "updateTime": 1499827319559,
        //             "isWorking": true
        //         }
        //     ]
        //
        //  futures
        //
        //     [
        //         {
        //             "symbol": "BTCUSDT",
        //             "orderId": 1,
        //             "clientOrderId": "myOrder1",
        //             "price": "0.1",
        //             "origQty": "1.0",
        //             "executedQty": "1.0",
        //             "cumQuote": "10.0",
        //             "status": "NEW",
        //             "timeInForce": "GTC",
        //             "type": "LIMIT",
        //             "side": "BUY",
        //             "stopPrice": "0.0",
        //             "updateTime": 1499827319559
        //         }
        //     ]
        //
        return this.parseOrders (response, market, since, limit);
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = undefined;
        let query = undefined;
        let type = undefined;
        const request = {};
        if (symbol !== undefined) {
            market = this.market (symbol);
            request['symbol'] = market['id'];
            const defaultType = this.safeString2 (this.options, 'fetchOpenOrders', 'defaultType', market['type']);
            type = this.safeString (params, 'type', defaultType);
            query = this.omit (params, 'type');
        } else if (this.options['warnOnFetchOpenOrdersWithoutSymbol']) {
            const symbols = this.symbols;
            const numSymbols = symbols.length;
            const fetchOpenOrdersRateLimit = parseInt (numSymbols / 2);
            throw new ExchangeError (this.id + ' fetchOpenOrders WARNING: fetching open orders without specifying a symbol is rate-limited to one call per ' + fetchOpenOrdersRateLimit.toString () + ' seconds. Do not call this method frequently to avoid ban. Set ' + this.id + '.options["warnOnFetchOpenOrdersWithoutSymbol"] = false to suppress this warning message.');
        } else {
            const defaultType = this.safeString2 (this.options, 'fetchOpenOrders', 'defaultType', 'spot');
            type = this.safeString (params, 'type', defaultType);
            query = this.omit (params, 'type');
        }
        let method = 'privateGetOpenOrders';
        if (type === 'future') {
            method = 'fapiPrivateGetOpenOrders';
        } else if (type === 'delivery') {
            method = 'dapiPrivateGetOpenOrders';
        } else if (type === 'margin') {
            method = 'sapiGetMarginOpenOrders';
        }
        const response = await this[method] (this.extend (request, query));
        return this.parseOrders (response, market, since, limit);
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const orders = await this.fetchOrders (symbol, since, limit, params);
        return this.filterBy (orders, 'status', 'closed');
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

    parseTransactionStatusByType (status, type = undefined) {
        const statusesByType = {
            'deposit': {
                '0': 'pending',
                '1': 'ok',
            },
            'withdrawal': {
                '0': 'pending', // Email Sent
                '1': 'canceled', // Cancelled (different from 1 = ok in deposits)
                '2': 'pending', // Awaiting Approval
                '3': 'failed', // Rejected
                '4': 'pending', // Processing
                '5': 'failed', // Failure
                '6': 'ok', // Completed
            },
        };
        const statuses = this.safeValue (statusesByType, type, {});
        return this.safeString (statuses, status, status);
    }

    parseTradingFee (fee, market = undefined) {
        const marketId = this.safeString (market, 'symbol');
        const symbol = this.safeSymbol (marketId);
        return {
            'symbol': symbol,
            'maker': this.safeNumber (fee, 'makerCommissionRate'),
            'taker': this.safeNumber (fee, 'takerCommissionRate'),
        };
    }

    async fetchTradingFee (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        const response = await this.wapiGetTradeFee (this.extend (request, params));
        //
        //     {
        //         "tradeFee": [
        //             {
        //                 "symbol": "ADABNB",
        //                 "maker": 0.9000,
        //                 "taker": 1.0000
        //             }
        //         ],
        //         "success": true
        //     }
        //
        const tradeFee = this.safeValue (response, 'tradeFee', []);
        const first = this.safeValue (tradeFee, 0, {});
        return this.parseTradingFee (first);
    }

    async fetchTradingFees (params = {}) {
        await this.loadMarkets ();
        const response = await this.wapiGetTradeFee (params);
        //
        //     {
        //         "tradeFee": [
        //             {
        //                 "symbol": "ADABNB",
        //                 "maker": 0.9000,
        //                 "taker": 1.0000
        //             }
        //         ],
        //         "success": true
        //     }
        //
        const tradeFee = this.safeValue (response, 'tradeFee', []);
        const result = {};
        for (let i = 0; i < tradeFee.length; i++) {
            const fee = this.parseTradingFee (tradeFee[i]);
            const symbol = fee['symbol'];
            result[symbol] = fee;
        }
        return result;
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

    handleErrors (code, reason, url, method, headers, body, response, requestHeaders, requestBody) {
        if ((code === 418) || (code === 429)) {
            throw new DDoSProtection (this.id + ' ' + code.toString () + ' ' + reason + ' ' + body);
        }
        // error response in a form: { "code": -1013, "msg": "Invalid quantity." }
        // following block cointains legacy checks against message patterns in "msg" property
        // will switch "code" checks eventually, when we know all of them
        if (code >= 400) {
            if (body.indexOf ('Price * QTY is zero or less') >= 0) {
                throw new InvalidOrder (this.id + ' order cost = amount * price is zero or less ' + body);
            }
            if (body.indexOf ('LOT_SIZE') >= 0) {
                throw new InvalidOrder (this.id + ' order amount should be evenly divisible by lot size ' + body);
            }
            if (body.indexOf ('PRICE_FILTER') >= 0) {
                throw new InvalidOrder (this.id + ' order price is invalid, i.e. exceeds allowed price precision, exceeds min price or max price limits or is invalid float value in general, use this.priceToPrecision (symbol, amount) ' + body);
            }
        }
        if (response === undefined) {
            return; // fallback to default error handler
        }
        // check success value for wapi endpoints
        // response in format {'msg': 'The coin does not exist.', 'success': true/false}
        const success = this.safeValue (response, 'success', true);
        if (!success) {
            const message = this.safeString (response, 'msg');
            let parsedMessage = undefined;
            if (message !== undefined) {
                try {
                    parsedMessage = JSON.parse (message);
                } catch (e) {
                    // do nothing
                    parsedMessage = undefined;
                }
                if (parsedMessage !== undefined) {
                    response = parsedMessage;
                }
            }
        }
        const message = this.safeString (response, 'msg');
        if (message !== undefined) {
            this.throwExactlyMatchedException (this.exceptions, message, this.id + ' ' + message);
        }
        // checks against error codes
        const error = this.safeString (response, 'code');
        if (error !== undefined) {
            // https://github.com/ccxt/ccxt/issues/6501
            // https://github.com/ccxt/ccxt/issues/7742
            if ((error === '200') || (error === '0')) {
                return;
            }
            // a workaround for {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}
            // despite that their message is very confusing, it is raised by Binance
            // on a temporary ban, the API key is valid, but disabled for a while
            if ((error === '-2015') && this.options['hasAlreadyAuthenticatedSuccessfully']) {
                throw new DDoSProtection (this.id + ' temporary banned: ' + body);
            }
            const feedback = this.id + ' ' + body;
            this.throwExactlyMatchedException (this.exceptions, error, feedback);
            throw new ExchangeError (feedback);
        }
        if (!success) {
            throw new ExchangeError (this.id + ' ' + body);
        }
    }
};
