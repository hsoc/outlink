import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('android-r8-report.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReleaseReportTests(unittest.TestCase):
    def test_reads_each_dex_header_without_counting_native_code_as_dex(self):
        with tempfile.TemporaryDirectory() as folder:
            apk = Path(folder) / 'test.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                for name, count in [('classes.dex', 2), ('classes2.dex', 5), ('classes10.dex', 7)]:
                    header = bytearray(112)
                    header[:8] = b'dex\n039\0'
                    struct.pack_into('<I', header, 40, 0x12345678)
                    struct.pack_into('<I', header, 96, count)
                    archive.writestr(name, header)
                archive.writestr('lib/arm64-v8a/library.so', b'ELF')
            result = report.inspect_apk(apk)
            self.assertEqual(result['dex_classes'], 14)
            self.assertEqual(result['dex_bytes'], 336)
            self.assertEqual(result['native_library_bytes'], 3)

    def test_rejects_invalid_or_missing_dex(self):
        with tempfile.TemporaryDirectory() as folder:
            apk = Path(folder) / 'test.apk'
            for name, data in [('classes.dex', b'invalid'), ('assets/test', b'not dex')]:
                with zipfile.ZipFile(apk, 'w') as archive:
                    archive.writestr(name, data)
                with self.assertRaises(ValueError):
                    report.inspect_apk(apk)

    def test_checks_merged_flags_and_actual_renaming(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'mapping.txt').write_text('example.Module -> a.b:\n')
            for disabled in ['-dontoptimize', '-dontobfuscate', '-dontshrink']:
                (root / 'configuration.txt').write_text(disabled + '\n')
                with self.assertRaises(ValueError):
                    report.inspect_mapping(root)
            (root / 'configuration.txt').write_text('# normal consumer keep rules\n')
            self.assertEqual(report.inspect_mapping(root)['renamed_classes'], 1)
            (root / 'mapping.txt').write_text('example.Module -> example.Module:\n')
            with self.assertRaises(ValueError):
                report.inspect_mapping(root)


if __name__ == '__main__':
    unittest.main()
