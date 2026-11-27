import os
from ipaddress import ip_network

import uvicorn

from app.core.settings import positive_int


def trusted_proxies(value: str) -> list[str]:
    proxies = []
    for entry in filter(None, map(str.strip, value.split(","))):
        try:
            network = ip_network(entry)
        except ValueError:
            raise ValueError("FORWARDED_ALLOW_IPS must contain explicit proxy IPs or CIDRs") from None
        if network.prefixlen == 0:
            raise ValueError("FORWARDED_ALLOW_IPS must not trust all peers")
        proxies.append(str(network) if "/" in entry else str(network.network_address))
    return proxies


def main() -> None:
    proxies = trusted_proxies(os.getenv("FORWARDED_ALLOW_IPS", ""))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=positive_int("PORT", 10000),
        proxy_headers=bool(proxies),
        forwarded_allow_ips=proxies,
        workers=1,
    )


if __name__ == "__main__":
    main()
