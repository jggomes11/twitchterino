use serde_json::json;
use terino_prototype::model::{Account, AccountId, Channel, Identity, Platform};
use terino_prototype::platform::{lowest_playlist, parse_kick_identity, valid_endpoint};
fn account() -> Account {
    Account::new(AccountId::parse("account-1").unwrap())
}
fn identity(id: &str) -> Identity {
    Identity {
        id: id.into(),
        username: "fixture".into(),
    }
}
#[test]
fn only_four_slots() {
    assert!(AccountId::parse("account-4").is_ok());
    for v in ["account-0", "account-5", "../account-1", "account-01"] {
        assert!(AccountId::parse(v).is_err());
    }
}
#[test]
fn initial_balance_and_same_identity_refresh() {
    let mut a = account();
    a.channels = vec!["alpha".into()];
    a.adopt_identity(identity("1"));
    a.set_balance("alpha", 100, 1);
    assert_eq!(a.status["alpha"].gained, 0);
    a.set_balance("alpha", 110, 2);
    a.invalidate();
    a.adopt_identity(identity("1"));
    a.set_balance("alpha", 120, 3);
    assert_eq!(a.status["alpha"].gained, 20);
}
#[test]
fn another_identity_cannot_inherit_points() {
    let mut a = account();
    a.channels = vec!["alpha".into()];
    a.adopt_identity(identity("1"));
    a.set_balance("alpha", 100, 1);
    a.set_balance("alpha", 110, 2);
    a.adopt_identity(identity("2"));
    a.set_balance("alpha", 1000, 3);
    assert_eq!(a.status["alpha"].gained, 0);
}
#[test]
fn invalidation_rejects_pending_reply_and_snapshot_hides_private_data() {
    let mut a = account();
    a.adopt_identity(identity("1"));
    a.set_balance("alpha", 900, 1);
    let ticket = a.ticket();
    a.invalidate();
    assert!(!a.current(ticket));
    assert!(a.snapshot(Platform::Twitch, 5)["channels"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["points"].is_null()));
}
#[test]
fn scheduler_preserves_two_slots_and_subscription_priority() {
    let mut a = account();
    a.farming = true;
    a.rotation = true;
    a.adopt_identity(identity("1"));
    a.channels = vec!["alpha".into(), "bravo".into(), "charlie".into()];
    for s in a.channels.clone() {
        a.status.insert(
            s,
            Channel {
                live: true,
                points: Some(100),
                ..Default::default()
            },
        );
    }
    a.status.get_mut("charlie").unwrap().subscribed = true;
    let chosen = a.desired(Platform::Kick, 100);
    assert_eq!(chosen.len(), 2);
    assert!(chosen.contains(&"charlie".into()));
}
#[test]
fn slot_empty_does_not_request_players() {
    let a = account();
    assert!(a.desired(Platform::Kick, 0).is_empty());
}
#[test]
fn endpoints_reject_remote_urls_and_path_injection() {
    assert!(valid_endpoint(Platform::Twitch, "/gql", "POST"));
    assert!(!valid_endpoint(
        Platform::Twitch,
        "https://evil.test/gql",
        "POST"
    ));
    assert!(!valid_endpoint(
        Platform::Kick,
        "/api/v2/channels/../user",
        "GET"
    ));
    assert!(!valid_endpoint(
        Platform::Kick,
        "/api/v2/messages/send/1",
        "GET"
    ));
    assert!(valid_endpoint(
        Platform::Kick,
        "/api/v2/channels/alpha/points",
        "GET"
    ));
}
#[test]
fn identity_requires_real_id_and_username() {
    assert!(parse_kick_identity(&json!({"id":123,"username":"fixture"})).is_some());
    for v in [
        json!({"id":0,"username":"fixture"}),
        json!({"id":123}),
        json!({"id":123,"username":" "}),
    ] {
        assert!(parse_kick_identity(&v).is_none());
    }
}
#[test]
fn lowest_quality_is_a_real_variant_not_fabricated_160p() {
    let text="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=123000\nlow.m3u8\n";
    let result = lowest_playlist(text).unwrap();
    assert!(result.contains("low.m3u8"));
    assert!(!result.contains("high.m3u8"));
    assert!(lowest_playlist("#EXTM3U\n#EXTINF:4\nsegment.ts\n").is_none());
}
