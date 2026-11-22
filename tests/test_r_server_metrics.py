import json
import unittest
import r_server_metrics


class MetricsTests(unittest.TestCase):
    def test_remote_script_compiles(self):
        compile(r_server_metrics.REMOTE_SCRIPT, '<remote>', 'exec')

    def test_collection(self):
        payload = {'uptime_seconds': 100, 'disks': []}
        result = r_server_metrics.collect(lambda cmd: (json.dumps(payload), True))
        self.assertEqual(result, {'ok': True, 'data': payload})

    def test_unavailable(self):
        for response in [('', False), ('invalid', True), ('[]', True)]:
            self.assertEqual(r_server_metrics.collect(lambda _: response), {'ok': False, 'data': None})
