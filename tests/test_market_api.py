import json
import unittest
from unittest.mock import MagicMock, patch

import market_api
import crypto_api


class MarketTests(unittest.TestCase):
    def load(self, rows, pair='ALEO_USDT'):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(rows).encode()
        with patch.object(market_api, 'urlopen', return_value=response):
            return market_api.load(pair)

    def test_usdt_pair_and_precision(self):
        result = self.load([{'currency_pair': 'ALEO_USDT', 'last': '0.02915'}])
        self.assertEqual(result, {'pair': 'ALEO/USDT', 'price': '0.02915', 'source': 'Gate', 'quote': 'USDT'})
        self.assertEqual(crypto_api.SOURCES['/api/crypto/price/btc'][1], 60)

    def test_pearl_uses_native_pearl_not_perle(self):
        pair = market_api.SOURCES['/api/crypto/price/prl']
        self.assertEqual(pair, 'PEARL_USDT')
        result = self.load([{'currency_pair': pair, 'last': '1.9502'}], pair)
        self.assertEqual(result['pair'], 'PEARL/USDT')
        with self.assertRaises(ValueError):
            self.load([{'currency_pair': 'PRL_USDT', 'last': '0.07045'}], pair)
        with self.assertRaises(ValueError):
            market_api.load('PRL_USDT')

    def test_invalid_prices_and_wrong_pair(self):
        for value in [None, '', '0', '-1', 'NaN', 'Infinity', 'bad']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load([{'currency_pair': 'ALEO_USDT', 'last': value}])
        with self.assertRaises(ValueError):
            self.load([{'currency_pair': 'BTC_USDT', 'last': '65000'}])
        with self.assertRaises(ValueError):
            self.load([])
        with self.assertRaises(ValueError):
            market_api.load('USER_CONTROLLED')

    def test_price_cache_and_outage(self):
        class Handler:
            def _json(self, code, body):
                self.code, self.body = code, json.loads(body)
        handler = Handler()
        path = '/api/crypto/price/btc'
        with patch.dict(crypto_api._cache, {}, clear=True):
            with patch.object(market_api, 'load', return_value={'pair': 'BTC/USDT', 'price': '65000', 'quote': 'USDT'}) as loader:
                crypto_api.serve(handler, path)
                crypto_api.serve(handler, path)
                self.assertEqual(loader.call_count, 1)
            crypto_api._cache[path]['fetched_at'] = 1
            with patch.object(market_api, 'load', side_effect=OSError()):
                crypto_api.serve(handler, path)
                self.assertTrue(handler.body['stale'])
                self.assertEqual(handler.body['fetched_at'], 1)
                self.assertEqual(handler.body['data']['price'], '65000')


if __name__ == '__main__':
    unittest.main()
