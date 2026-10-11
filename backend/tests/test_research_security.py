import socket
from types import SimpleNamespace

import pytest

from app.research import retrieve


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://user:password@example.com",
        "http://example.com:8080",
    ],
)
def test_research_rejects_unsafe_schemes_credentials_and_ports(url):
    with pytest.raises(ValueError):
        retrieve(url, max_bytes=1024, timeout=1)


def test_research_rejects_private_dns_before_connecting(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))
        ],
    )
    with pytest.raises(ValueError, match="public network"):
        retrieve("http://example.com", max_bytes=1024, timeout=1)


def test_public_retrieval_tries_other_vetted_addresses_when_first_is_unreachable(
    monkeypatch,
):
    import http.client
    from io import BytesIO

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kw: [
            (
                socket.AF_INET6,
                socket.SOCK_STREAM,
                6,
                "",
                ("2606:2800:220:1:248:1893:25c8:1946", 80),
            ),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80)),
        ],
    )
    calls = []

    class Connected:
        def settimeout(self, value):
            pass

        def close(self):
            pass

    def connect(address, **kw):
        calls.append(address)
        if len(calls) == 1:
            raise OSError("Synthetic unreachable IPv6")
        return Connected()

    body = BytesIO(b"Grounded public passage")

    class Response:
        status = 200

        def getheader(self, key, default=None):
            return "text/plain" if key == "Content-Type" else default

        def read1(self, size):
            return body.read(size)

    class Connection:
        def __init__(self, *args, **kw):
            pass

        def request(self, *args, **kw):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(socket, "create_connection", connect)
    monkeypatch.setattr(http.client, "HTTPConnection", Connection)
    assert retrieve("http://example.com", max_bytes=1024, timeout=2) == (
        "http://example.com",
        "Grounded public passage",
    )
    assert len(calls) == 2


def test_public_redirect_to_private_network_is_rejected(monkeypatch):
    import http.client

    connections = []

    def addresses(host, *args, **kwargs):
        address = "127.0.0.1" if host == "localhost" else "93.184.216.34"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80))]

    class Response:
        status = 302

        def getheader(self, name, default=None):
            return "http://localhost/private" if name == "Location" else default

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(socket, "getaddrinfo", addresses)
    monkeypatch.setattr(
        socket,
        "create_connection",
        lambda address, **kwargs: (
            connections.append(address)
            or SimpleNamespace(settimeout=lambda value: None)
        ),
    )
    monkeypatch.setattr(http.client, "HTTPConnection", Connection)
    with pytest.raises(ValueError, match="public network"):
        retrieve("http://example.com", max_bytes=1024, timeout=1)
    assert connections == [("93.184.216.34", 80)]
