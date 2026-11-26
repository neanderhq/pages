"""Verify literal managed environment loading in the actual production image."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class EntrypointTests(unittest.TestCase):
    def test_shell_looking_secret_is_literal(self):
        value = "$(touch /tmp/pages-entrypoint-executed) equals= quote'\" # dollar$"
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / 'environment'
            bundle.write_text(
                'DATABASE_URL=postgresql://fixture:fixture@localhost/unused\n'
                'APP_URL=https://pages.example.test\n'
                'BETTER_AUTH_SECRET=fixture-only-strong-entrypoint-auth-secret\n'
                f'DEMO_PASSWORD={value}\n'
            )
            bundle.chmod(0o644)  # Only synthetic values, readable by image user node.
            code = (
                "if(require('fs').existsSync('/tmp/pages-entrypoint-executed'))process.exit(2);"
                "process.stdout.write(process.env.DEMO_PASSWORD)"
            )
            result = subprocess.run([
                'docker', 'run', '--rm', '--network=none', '-v',
                f'{bundle}:/run/secrets/neander_environment:ro',
                os.environ['NEANDER_TEMPLATE_IMAGE'], '-e', code,
            ], capture_output=True, text=True, timeout=30, check=True)
            self.assertEqual(result.stdout, value)


if __name__ == '__main__':
    unittest.main()
