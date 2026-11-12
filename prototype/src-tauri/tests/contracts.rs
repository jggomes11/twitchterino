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
        login: None,
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
    a.channels = vec!["alpha".into()];
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
#[test]
fn invalid_session_does_not_reopen_manual_player() {
    let mut a = account();
    a.channels = vec!["alpha".into()];
    a.adopt_identity(identity("1"));
    a.status.insert(
        "alpha".into(),
        Channel {
            live: true,
            shown: true,
            watching_since: Some(10),
            ..Default::default()
        },
    );
    a.invalidate();
    assert!(a.desired(Platform::Kick, 20).is_empty());
}
#[test]
fn chest_needs_both_balance_increase_and_claim_change() {
    use terino_prototype::platform::chest_confirmed;
    assert!(!chest_confirmed(100, 150, "old", Some("old")));
    assert!(!chest_confirmed(100, 149, "old", None));
    assert!(chest_confirmed(100, 150, "old", None));
}
#[test]
fn twitch_playlist_never_selects_audio_only() {
    let text="#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"low\"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=123000,RESOLUTION=284x160\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=50000,VIDEO=\"audio_only\"\naudio.m3u8\n";
    let result = lowest_playlist(text).unwrap();
    assert!(result.contains("low.m3u8"));
    assert!(!result.contains("audio.m3u8"));
}
#[test]
fn selection_rejects_old_revision_and_previous_document() {
    use terino_prototype::model::Selection;
    let mut s = Selection::default();
    let generation = s.generation;
    assert!(s.select(2, generation, 2));
    assert!(!s.select(1, generation, 1));
    assert_eq!(s.index, 2);
    s.new_document();
    assert!(!s.select(3, generation, 999));
    assert!(s.select(1, s.generation, 1));
}
#[test]
fn partial_chest_response_cannot_confirm_claim() {
    use terino_prototype::platform::confirmed_claim;
    let mut v = json!({"data":{"currentUser":{"id":"1"},"channel":{"channel":{"self":{"communityPoints":{"balance":150,"availableClaim":null}}}}}});
    assert!(confirmed_claim(&v, "id:1", 100, "old").is_some());
    v["errors"] = json!([{"message":"partial"}]);
    assert!(confirmed_claim(&v, "id:1", 100, "old").is_none());
    v.as_object_mut().unwrap().remove("errors");
    v["data"]["channel"]["channel"]["self"]["communityPoints"]
        .as_object_mut()
        .unwrap()
        .remove("availableClaim");
    assert!(confirmed_claim(&v, "id:1", 100, "old").is_none());
}
#[test]
fn private_relationships_and_watch_time_do_not_survive_another_identity() {
    let mut a = account();
    a.channels = vec!["alpha".into()];
    a.adopt_identity(identity("1"));
    a.status.insert(
        "alpha".into(),
        Channel {
            points: Some(900),
            following: Some(true),
            subscribed: true,
            multiplier: 2.,
            watched_ms: 120_000,
            ..Default::default()
        },
    );
    a.invalidate();
    let s = a.snapshot(Platform::Twitch, 5);
    let c = &s["channels"][0];
    assert!(c["following"].is_null());
    assert_eq!(c["subscribed"], false);
    assert_eq!(c["watchedMin"], 0);
    a.adopt_identity(identity("2"));
    let s = a.snapshot(Platform::Twitch, 5);
    assert!(s["channels"][0]["following"].is_null());
    assert_eq!(s["channels"][0]["watchedMin"], 0);
}
#[test]
fn stale_balance_cannot_double_count_a_confirmed_chest() {
    let mut a = account();
    a.adopt_identity(identity("1"));
    a.set_balance_observed("alpha", 100, 1, 1);
    a.set_balance_observed("alpha", 150, 2, 3);
    assert!(!a.set_balance_observed("alpha", 100, 3, 2));
    a.set_balance_observed("alpha", 150, 4, 4);
    assert_eq!(a.status["alpha"].gained, 50);
}
#[test]
fn twitch_playlist_retains_interleaved_media_group_metadata() {
    let text="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\nhigh.m3u8\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"low\"\n#EXT-X-STREAM-INF:BANDWIDTH=123000,RESOLUTION=284x160,VIDEO=\"low\"\nlow.m3u8\n";
    assert!(lowest_playlist(text)
        .unwrap()
        .contains("#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"low\""));
}
#[test]
fn twitch_does_not_rewrite_a_playlist_without_video_variants() {
    use terino_prototype::platform::lowest_playlist_for;
    let text="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=50000,VIDEO=\"audio_only\"\naudio.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nunknown.m3u8\n";
    assert!(lowest_playlist_for(Platform::Twitch, text).is_none());
}
#[test]
fn selected_reward_price_is_not_the_next_balance_goal() {
    use terino_prototype::model::Reward;
    let mut a = account();
    a.channels = vec!["alpha".into()];
    a.adopt_identity(identity("1"));
    a.bonus_target = json!("xp:3");
    a.status.insert(
        "alpha".into(),
        Channel {
            points: Some(900),
            rewards: vec![Reward {
                id: "r".into(),
                kind: "xp".into(),
                hours: 3,
                cost: 800,
                available: true,
            }],
            ..Default::default()
        },
    );
    assert_eq!(
        a.snapshot(Platform::Twitch, 1)["channels"][0]["targetCost"],
        800
    );
}
