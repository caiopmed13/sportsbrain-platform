// SportsBrain Rust Gateway — high-throughput WebSocket fanout + Redis Streams consumer.
// Lê snapshot updates de Redis Streams (chave sb:odds_updates), publica pra clientes
// conectados via WS /ws/odds/:event_id. Também expõe REST cache proxy.
//
// Rodar: cargo run --release
// Deploy VPS: docker build; caddy reverse-proxy pra :8300

use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, Path, State},
    response::IntoResponse,
    routing::{get},
    Json, Router,
};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer, compression::CompressionLayer, trace::TraceLayer};

type EventId = String;
type Tx = broadcast::Sender<String>;

#[derive(Clone)]
struct AppState {
    rooms: Arc<DashMap<EventId, Tx>>,
    redis_url: String,
    pg_pool: Option<sqlx::PgPool>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OddsUpdate {
    event_id: String,
    market: String,
    book: String,
    outcome: String,
    line: Option<f64>,
    price: f64,
    ts: i64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt().with_env_filter("info,sportsbrain_gateway=debug").init();

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let pg_url = std::env::var("DATABASE_URL").ok();

    let pg_pool = if let Some(url) = &pg_url {
        match sqlx::postgres::PgPoolOptions::new().max_connections(8).connect(url).await {
            Ok(p) => Some(p),
            Err(e) => { tracing::warn!("pg connect failed: {e}"); None }
        }
    } else { None };

    let state = AppState { rooms: Arc::new(DashMap::new()), redis_url: redis_url.clone(), pg_pool };

    // Spawn redis streams consumer
    let state_bg = state.clone();
    tokio::spawn(async move {
        if let Err(e) = consume_redis_streams(state_bg).await {
            tracing::error!("redis consumer died: {e}");
        }
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/ws/odds/:event_id", get(ws_handler))
        .route("/v1/odds/snapshot/:event_id", get(snapshot_handler))
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:8300".parse()?;
    tracing::info!("gateway listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "rooms": s.rooms.len(),
        "pg": s.pg_pool.is_some(),
    }))
}

async fn snapshot_handler(
    State(s): State<AppState>,
    Path(event_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = &s.pg_pool else {
        return Json(serde_json::json!({ "error": "pg not configured" }));
    };
    let rows: Vec<(String, String, String, Option<f64>, f64)> = sqlx::query_as(
        "SELECT market, book, outcome, line, price
         FROM odds_snapshots
         WHERE event_id = $1
         ORDER BY ts DESC
         LIMIT 200"
    ).bind(&event_id).fetch_all(pool).await.unwrap_or_default();
    Json(serde_json::json!({ "event_id": event_id, "snapshots": rows.len() }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(event_id): Path<String>,
    State(s): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, event_id, s))
}

async fn handle_socket(socket: WebSocket, event_id: EventId, s: AppState) {
    let (mut sender, mut receiver) = socket.split();

    let tx = s.rooms.entry(event_id.clone()).or_insert_with(|| {
        let (tx, _) = broadcast::channel::<String>(256);
        tx
    }).clone();
    let mut rx = tx.subscribe();

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() { break; }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => break,
                Message::Ping(_) => {},
                _ => {}
            }
        }
    });

    tokio::select! { _ = send_task => {}, _ = recv_task => {} }
}

async fn consume_redis_streams(state: AppState) -> anyhow::Result<()> {
    use redis::AsyncCommands;
    let client = redis::Client::open(state.redis_url.clone())?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let stream_key = "sb:odds_updates";
    let mut last_id = "$".to_string();

    loop {
        let opts = redis::streams::StreamReadOptions::default().block(5000).count(500);
        let resp: redis::streams::StreamReadReply = conn
            .xread_options(&[stream_key], &[&last_id], &opts)
            .await
            .unwrap_or(redis::streams::StreamReadReply { keys: vec![] });

        for k in resp.keys {
            for entry in k.ids {
                last_id = entry.id.clone();
                // expected fields: event_id, payload (JSON)
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("payload") {
                    let payload = String::from_utf8_lossy(bytes).to_string();
                    if let Ok(upd) = serde_json::from_str::<OddsUpdate>(&payload) {
                        if let Some(tx) = state.rooms.get(&upd.event_id) {
                            let _ = tx.send(payload);
                        }
                    }
                }
            }
        }
    }
}
