"""Inspect actual APK DEX headers and require effective R8 output for release builds."""
import argparse
import json
from pathlib import Path
import re
import struct
import zipfile


def inspect_apk(apk_path):
    dex = []
    native_bytes = 0
    with zipfile.ZipFile(apk_path) as archive:
        for entry in archive.infolist():
            if re.fullmatch(r"classes(?:[2-9][0-9]*|1[0-9]+)?\.dex", entry.filename):
                with archive.open(entry) as stream:
                    header = stream.read(112)
                if len(header) != 112 or not header.startswith(b"dex\n") or struct.unpack_from('<I', header, 40)[0] != 0x12345678:
                    raise ValueError(f"Invalid DEX header: {entry.filename}")
                dex.append({"name": entry.filename, "bytes": entry.file_size,
                            "compressed_bytes": entry.compress_size,
                            "classes": struct.unpack_from('<I', header, 96)[0]})
            elif entry.filename.startswith('lib/') and entry.filename.endswith('.so'):
                native_bytes += entry.file_size
    if not dex:
        raise ValueError('No DEX files in APK')
    return {"apk_bytes": Path(apk_path).stat().st_size, "dex_files": dex,
            "dex_bytes": sum(item['bytes'] for item in dex),
            "dex_compressed_bytes": sum(item['compressed_bytes'] for item in dex),
            "dex_classes": sum(item['classes'] for item in dex),
            "native_library_bytes": native_bytes}


def inspect_mapping(directory):
    mapping = (Path(directory) / 'mapping.txt').read_text()
    configuration = (Path(directory) / 'configuration.txt').read_text()
    if re.search(r'^\s*-dont(?:optimize|obfuscate|shrink)(?:\s|$)', configuration, re.MULTILINE):
        raise ValueError('Merged R8 rules disable shrinking, optimization or obfuscation')
    renamed = sum(original != rewritten for original, rewritten in
                  re.findall(r'^([^#\s].*?) -> (\S+):$', mapping, re.MULTILINE))
    if not renamed:
        raise ValueError('No renamed classes in R8 mapping; obfuscation was not verified')
    return {"renamed_classes": renamed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', required=True)
    parser.add_argument('--mapping')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = inspect_apk(args.apk)
    if args.mapping:
        result.update(inspect_mapping(args.mapping))
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
