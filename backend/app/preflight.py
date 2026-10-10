"""Parse untrusted originals in a disposable, resource-limited Linux process."""

import json
import sys


def main() -> None:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    request = json.loads(sys.stdin.buffer.readline())
    cpu_seconds = 15 if request["filename"].lower().endswith(".pdf") else 5
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    from app.config import Settings
    from app.storage import _inspect_upload

    result = _inspect_upload(
        request["filename"],
        sys.stdin.buffer.read(),
        Settings(**request["limits"]),
    )
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
