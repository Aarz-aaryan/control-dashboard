import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import mining_watch as watch


class WatchTests(unittest.TestCase):
    def reading(self, level):
        return {'level': level, 'detail': 'test reading'}

    def test_two_failures_one_alert_and_no_spam(self):
        state, message = watch.transition({}, self.reading('down'))
        self.assertIsNone(message)
        state, message = watch.transition(state, self.reading('down'))
        self.assertIn('Mining stopped', message)
        state, message = watch.transition(state, self.reading('down'))
        self.assertIsNone(message)
        state, message = watch.transition(state, self.reading('healthy'))
        self.assertIn('Mining recovered', message)
        self.assertIsNone(watch.transition(state, self.reading('healthy'))[1])

    def test_interrupted_failures_do_not_alert(self):
        state, _ = watch.transition({}, self.reading('down'))
        state, message = watch.transition(state, self.reading('healthy'))
        self.assertIsNone(message)
        self.assertIsNone(watch.transition(state, self.reading('down'))[1])

    def test_unavailable_is_not_mining_down(self):
        state, _ = watch.transition({}, self.reading('unknown'))
        state, message = watch.transition(state, self.reading('unknown'))
        self.assertIn('Monitoring unavailable', message)
        self.assertNotIn('Mining stopped', message)
        _, message = watch.transition(state, self.reading('healthy'))
        self.assertIn('Monitoring restored', message)

    def test_pool_classification(self):
        data = {'workers': {'online': 2, 'all': 2, 'offline': 0, 'dead': 5}, 'hashrate': 300, 'unit': 'TH/s'}
        self.assertEqual(watch.pool_reading(data)['level'], 'healthy')
        data['workers'].update(all=3, offline=1)
        self.assertEqual(watch.pool_reading(data)['level'], 'degraded')
        data['hashrate'] = 0
        self.assertEqual(watch.pool_reading(data)['level'], 'down')

    def test_source_failure_is_unknown(self):
        with patch.object(watch.gpu_api, 'load', side_effect=OSError('private error')):
            result = watch.check('mx1')
        self.assertEqual(result['level'], 'unknown')
        self.assertNotIn('private error', result['detail'])

    def test_pending_delivery_persists_and_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / 'state.json'
            config_path = Path(directory) / 'config.json'
            config_path.write_text('{"channel_id":"123"}')
            readings = {key: self.reading('healthy') for key in watch.LABELS}
            readings['prl'] = self.reading('down')
            with patch.object(watch, 'STATE', state_path), patch.object(watch, 'CONFIG', config_path), \
                 patch.object(watch, 'check', side_effect=lambda key: readings[key]), patch.object(watch, 'send') as send:
                watch.run()
                send.assert_not_called()
                send.side_effect = OSError('Discord offline')
                with self.assertRaises(OSError):
                    watch.run()
                state = json.loads(state_path.read_text())
                self.assertEqual(len(state['pending']), 1)
                self.assertEqual(state['checks']['prl']['notified'], 'down')
                send.side_effect = None
                watch.run()
                self.assertEqual(len(json.loads(state_path.read_text())['pending']), 0)
                self.assertEqual(send.call_count, 2)


if __name__ == '__main__':
    unittest.main()
