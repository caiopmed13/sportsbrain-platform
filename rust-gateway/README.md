# SportsBrain Rust Gateway

High-throughput WebSocket fan-out + Postgres/Timescale snapshot proxy.

- Lê Redis Streams (`sb:odds_updates`) populado pelos scrapers
- Broadcasta updates via WS `/ws/odds/:event_id` pra clientes inscritos
- REST `/v1/odds/snapshot/:event_id` consulta TimescaleDB

## Env
- `REDIS_URL` (default `redis://127.0.0.1:6379`)
- `DATABASE_URL` (Postgres/Timescale)

## Rodar
```
cargo run --release
# ou docker-compose (ver infra/)
```

## Arquitetura
Cloudflare Worker serve REST pesado; Rust Gateway serve hot-path WS (milhões de ticks/min).
Rust é 10-40× mais throughput que Node pra WS fanout — essencial pra escala OddsJam-level.
