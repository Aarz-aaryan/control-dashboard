import json
import subprocess
import unittest
from unittest.mock import patch

import crypto_api
import gpu_api


class GPUReadingsTests(unittest.TestCase):
    def test_parse_multiple_gpus_and_unavailable_sensor(self):
        self.assertEqual(gpu_api.parse('0, NVIDIA GeForce RTX 3080, 65\n1, RTX 3060 Ti, 61\n'), [
            {'index': 0, 'name': 'NVIDIA GeForce RTX 3080', 'temperature_c': 65},
            {'index': 1, 'name': 'RTX 3060 Ti', 'temperature_c': 61}])
        self.assertIsNone(gpu_api.parse('0, GPU, N/A\n')[0]['temperature_c'])

    def test_bad_readings_fail_closed(self):
        for raw in ('', '0, GPU, 999', '0, GPU, -1', '0, GPU, nan', '0, GPU, 60\n0, GPU, 61', 'unexpected'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                gpu_api.parse(raw)

    def test_fixed_read_only_command_and_timeout(self):
        with patch.object(gpu_api.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '0, RTX 3060, 59\n', '')) as run:
            self.assertEqual(gpu_api.load('mx2')['host'], 'mx2')
        args = run.call_args.args[0]
        self.assertEqual(args[-2:], ['mx2@mx2', gpu_api.COMMAND])
        self.assertIn('BatchMode=yes', args)
        self.assertIn('StrictHostKeyChecking=yes', args)
        self.assertEqual(run.call_args.kwargs['timeout'], 12)
        with self.assertRaises(ValueError):
            gpu_api.load('unapproved-host')

    def test_five_minute_cache_and_independent_failure(self):
        class Handler:
            def _json(self, code, body):
                self.code, self.body = code, json.loads(body)
        handler = Handler()
        path = '/api/crypto/gpu/mx1'
        self.assertEqual(crypto_api.SOURCES[path][1], 300)
        with patch.dict(crypto_api._cache, {}, clear=True), patch.object(crypto_api.time, 'time', return_value=1000):
            with patch.object(gpu_api, 'load', return_value={'host': 'mx1', 'gpus': []}) as load:
                crypto_api.serve(handler, path)
                crypto_api.serve(handler, path)
                self.assertEqual(load.call_count, 1)
                self.assertFalse(handler.body['stale'])
            with patch.object(crypto_api.time, 'time', return_value=1301), patch.object(gpu_api, 'load', side_effect=OSError()):
                crypto_api.serve(handler, path)
                self.assertEqual(handler.code, 200)
                self.assertTrue(handler.body['stale'])
                self.assertEqual(handler.body['fetched_at'], 1000)
                crypto_api.serve(handler, '/api/crypto/gpu/mx2')
                self.assertEqual(handler.code, 502)


if __name__ == '__main__':
    unittest.main()
