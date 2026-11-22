import json
import unittest
from unittest.mock import patch

import crypto_api
import mining_api
import market_api
import gpu_api


def revenue_html(coin='ALEO', order=None):
    values = {'Total Income': '1.00000001', 'Yesterday’s Revenue': '2.00000002',
              'Total Payout': '3.00000003', 'Today’s Est. Revenue': '4.00000004', 'Balance': '5.00000005'}
    return ''.join(f'<div class="item-val"><div class="title">{label}</div><div class="num">'
                   f'<span class="{"balance-num" if label == "Balance" else "val"}">{values[label]}</span>'
                   f'<span class="code">{coin}</span></div></div>' for label in (order or values))


class MiningTests(unittest.TestCase):
    def setUp(self):
        self.share = patch.object(mining_api, 'SHARE', 'synthetic-share')
        self.share.start()
        self.addCleanup(self.share.stop)
        accounts = {coin: dict(config, account='test-' + coin)
                    for coin, config in mining_api.ACCOUNTS.items()}
        self.accounts = patch.dict(mining_api.ACCOUNTS, accounts)
        self.accounts.start()
        self.addCleanup(self.accounts.stop)

    def test_missing_configuration_fails_closed(self):
        with patch.object(mining_api, 'SHARE', ''):
            with self.assertRaises(ValueError):
                mining_api.source_url('btc')
        with patch.object(mining_api, 'SHARE', '../unexpected'):
            with self.assertRaises(ValueError):
                mining_api.source_url('btc')
        with patch.dict(mining_api.ACCOUNTS['btc'], account=''):
            with self.assertRaises(ValueError):
                mining_api.source_url('btc')

    def test_aleo_uses_correct_currency_route(self):
        self.assertIn('/mining-user-aleo/', mining_api.source_url('aleo'))
        self.assertIn('user_name=test-aleo', mining_api.source_url('aleo'))
        self.assertNotIn('online', ' '.join(p for p in mining_api.SOURCES if '/aleo/' in p))
        self.assertNotIn('/api/crypto/spot', crypto_api.SOURCES)
        self.assertEqual(set(crypto_api.SOURCES), set(mining_api.SOURCES) | set(market_api.SOURCES) | set(gpu_api.SOURCES) | {'/api/crypto/pi'})

    def test_pearl_routes_and_market(self):
        self.assertIn('/mining-user-prl/', mining_api.source_url('prl'))
        self.assertIn('user_name=test-prl', mining_api.source_url('prl'))
        for view in ('summary', 'day', 'month', 'distribution', 'distribution-day'):
            self.assertEqual(mining_api.SOURCES[f'/api/crypto/mining/prl/{view}'], ('prl', view))
        self.assertNotIn('/api/crypto/mining/prl/online-day', mining_api.SOURCES)
        self.assertEqual(market_api.SOURCES['/api/crypto/price/prl'], 'PEARL_USDT')

    def test_pearl_summary_uses_prl_currency_and_th_scale(self):
        workers = {'summary': {'hash_rate': '312181337806363', 'hash_rate_daily': '238836730238560',
                               'reject_rate': '0.52'},
                   'worker_length_all': 2, 'worker_length_online': 2, 'worker_length_offline': 0,
                   'worker_length_dead': 0}
        with patch.object(mining_api, 'request', side_effect=[revenue_html('PRL'), {'originData': workers}]) as request:
            result = mining_api.load('prl', 'summary')
        self.assertEqual(result['account'], 'test-prl')
        self.assertEqual(result['coin'], 'PRL')
        self.assertEqual(result['unit'], 'TH/s')
        self.assertAlmostEqual(result['hashrate'], 312.181337806363)
        self.assertEqual(result['revenue']['balance'], '5.00000005')
        self.assertEqual(request.call_args.kwargs['currency'], 'PRL')
        self.assertEqual(request.call_args.kwargs['account'], 'test-prl')

    def test_pearl_history_preserves_source_values(self):
        history = {'key': 'PRL (TH/s)', 'values': [[123, 0], [456, 312.1813]]}
        with patch.object(mining_api, 'request', return_value={'data': {'hashrate_history': history}}):
            self.assertEqual(mining_api.load('prl', 'day')['hashrate'], history)
        with patch.object(mining_api, 'request', return_value=revenue_html('ALEO')):
            with self.assertRaises(ValueError):
                mining_api.load('prl', 'summary')

    def test_history_preserves_source_values_and_zeroes(self):
        data = {'hashrate_history': {'key': 'ALEO (Mproof/s)', 'values': [[123, 0], [456, 812.1234]]},
                'hashrate_history_stale_rate': {'values': [[123, 0], [456, .01]]}}
        with patch.object(mining_api, 'request', return_value={'data': data}) as request:
            result = mining_api.load('aleo', 'month')
        self.assertEqual(result['hashrate'], data['hashrate_history'])
        self.assertEqual(result['rejected'], data['hashrate_history_stale_rate'])
        request.assert_called_once_with('aleo', action='load_by_duration', duration=30)

    def test_wrong_currency_fails_closed(self):
        with patch.object(mining_api, 'request', return_value={'data': {'hashrate_history': {'key': 'BTC (TH/s)'}}}):
            with self.assertRaises(ValueError):
                mining_api.load('aleo', 'day')

    def test_distribution_period_matches_f2pool(self):
        with patch.object(mining_api, 'request', return_value={'data': {'worker_hashrate_distribution': {}}}) as request:
            mining_api.load('btc', 'distribution-day')
        self.assertEqual(request.call_args.kwargs['hashrate_type'], '24h')

    def test_revenue_and_summary_allowlist(self):
        html = revenue_html()
        workers = {'summary': {'hash_rate': '850000000', 'hash_rate_daily': '750000000', 'reject_rate': '0.01'},
                   'worker_length_all': 3, 'worker_length_online': 3, 'worker_length_offline': 0,
                   'worker_length_dead': 4, 'workers': [{'ip': 'private', 'name': 'private'}]}
        with patch.object(mining_api, 'request', side_effect=[html, {'originData': workers}]):
            result = mining_api.load('aleo', 'summary')
        self.assertEqual(result['hashrate'], 850)
        self.assertEqual(set(result['revenue']), {'total', 'paid', 'balance'})
        self.assertEqual(result['revenue']['balance'], '5.00000005')
        self.assertNotIn('private', json.dumps(result))

    def test_revenue_mapping_ignores_order_and_rejects_wrong_currency(self):
        parser = mining_api.RevenueParser()
        parser.feed(revenue_html(order=['Balance', 'Total Payout', 'Total Income', 'Today’s Est. Revenue', 'Yesterday’s Revenue']))
        self.assertEqual(parser.revenue('aleo')['total'], '1.00000001')
        self.assertEqual(parser.revenue('aleo')['paid'], '3.00000003')
        self.assertEqual(parser.revenue('aleo')['balance'], '5.00000005')
        with self.assertRaises(ValueError):
            parser.revenue('btc')
        duplicate = mining_api.RevenueParser()
        with self.assertRaises(ValueError):
            duplicate.feed(revenue_html() + revenue_html())

    def test_unused_revenue_fields_are_not_required(self):
        parser = mining_api.RevenueParser()
        parser.feed(revenue_html(order=['Total Income', 'Total Payout', 'Balance']))
        self.assertEqual(parser.revenue('aleo'), {
            'total': '1.00000001', 'paid': '3.00000003', 'balance': '5.00000005'})

    def test_graph_readings_fail_closed_instead_of_hiding_bad_points(self):
        for points in [[[1, None]], [[1, float('nan')]], [[2, 1], [1, 2]], [[1, -1]], [[1]]]:
            with self.subTest(points=points), self.assertRaises(ValueError):
                mining_api.validate_series({'values': points})
        with self.assertRaises(ValueError):
            mining_api.validate_series({'values': [[1, 101]]}, percent=True)
        mining_api.validate_series({'values': [[1, 0], [2, 82.1234]]})

    def test_changed_revenue_markup_not_silently_zero(self):
        with patch.object(mining_api, 'request', return_value='<html>challenge</html>'):
            with self.assertRaises(ValueError):
                mining_api.load('btc', 'summary')

    def test_cache_and_stale_fallback(self):
        class Handler:
            def _json(self, code, body):
                self.code, self.body = code, json.loads(body)
        handler = Handler()
        path = '/api/crypto/mining/btc/day'
        with patch.dict(crypto_api._cache, {}, clear=True):
            with patch.object(mining_api, 'load', return_value={'hashrate': {'values': [[1, 0]]}}) as load:
                crypto_api.serve(handler, path)
                self.assertFalse(handler.body['stale'])
                crypto_api.serve(handler, path)
                self.assertEqual(load.call_count, 1)
            crypto_api._cache[path]['fetched_at'] = 1
            with patch.object(mining_api, 'load', side_effect=OSError()):
                crypto_api.serve(handler, path)
                self.assertEqual(handler.code, 200)
                self.assertTrue(handler.body['stale'])
                self.assertEqual(handler.body['fetched_at'], 1)
        with patch.dict(crypto_api._cache, {}, clear=True), patch.object(mining_api, 'load', side_effect=OSError()):
            crypto_api.serve(handler, path)
            self.assertEqual(handler.code, 502)


if __name__ == '__main__':
    unittest.main()
