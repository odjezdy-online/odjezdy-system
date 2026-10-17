#!/usr/bin/env python3
"""Tiny QEMU QMP client for the tests: screenshot / type / key.

  qmp.py SOCK shot FILE.png
  qmp.py SOCK type 'text to type\\n'        (types on the guest keyboard; \\n = Enter)
  qmp.py SOCK key alt+f2
"""
import json, socket, sys, time

SPECIAL = {"'": 'apostrophe', '"': 'shift+apostrophe', '&': 'shift+7', '*': 'shift+8', '=': 'equal',
           '+': 'shift+equal', '<': 'shift+comma', '#': 'shift+3', '$': 'shift+4', '(': 'shift+9',
           ')': 'shift+0', ';': 'semicolon', '|': 'shift+backslash', '>': 'shift+dot', ':': 'shift+semicolon',
           ' ': 'spc', '-': 'minus', '/': 'slash', '.': 'dot', '\n': 'ret', '_': 'shift+minus',
           '?': 'shift+slash', '\\': 'backslash', ',': 'comma'}


def connect(path):
    s = socket.socket(socket.AF_UNIX)
    s.connect(path)
    f = s.makefile('rw')
    f.readline()

    def call(msg):
        f.write(json.dumps(msg) + "\n")
        f.flush()
        while True:
            r = json.loads(f.readline())
            if 'return' in r or 'error' in r:
                return r

    call({"execute": "qmp_capabilities"})
    return call


def send_key(call, combo):
    call({"execute": "send-key", "arguments": {"keys": [{"type": "qcode", "data": k} for k in combo.split('+')]}})


def main(argv):
    call = connect(argv[1])
    cmd = argv[2]
    if cmd == 'shot':
        print(call({"execute": "screendump", "arguments": {"filename": argv[3], "format": "png"}}))
    elif cmd == 'key':
        send_key(call, argv[3])
    elif cmd == 'type':
        for ch in argv[3].replace('\\n', '\n'):
            send_key(call, SPECIAL[ch] if ch in SPECIAL else ('shift+' + ch.lower() if ch.isupper() else ch))
            time.sleep(0.03)
    else:
        sys.exit('unknown command ' + cmd)


if __name__ == '__main__':
    main(sys.argv)
