//! Complete witness storage and collision indices survive borrowed operations.

use super::{Consumed, FactRole, NativeFacts, fact};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
    sync::Arc,
};

#[test]
fn borrowed_witness_keeps_complete_packet_allocation_and_owner_identity_on_all_exits() {
    let path = Path::new("/project/tsconfig.json");
    let stamp = fact(path, b"A", path, FactRole::Configuration);
    let owner = Arc::clone(stamp.owner().unwrap());
    let changed = fact(path, b"B", path, FactRole::Configuration);
    for qualified in [true, false] {
        let mut facts = NativeFacts::new(true);
        facts.record_owned(Consumed {
            value: (),
            stamps: vec![stamp.clone(), changed.clone()],
            qualified,
        });
        let expected = facts.witness();
        let allocation = facts.stamps.as_ptr();
        let success = facts.with_witness(|packet| {
            assert_eq!(packet.stamps.as_ptr(), allocation);
            assert_eq!(packet.stamps, expected.stamps);
            assert_eq!(packet.qualified, qualified);
            assert!(Arc::ptr_eq(packet.stamps[0].owner().unwrap(), &owner));
            17
        });
        assert_eq!(success, 17);
        let failure: Result<(), u8> = facts.with_witness(|packet| {
            assert_eq!(packet.stamps.as_ptr(), allocation);
            assert_eq!(packet.stamps, expected.stamps);
            assert_eq!(packet.qualified, qualified);
            Err(23)
        });
        assert_eq!(failure, Err(23));
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                facts.with_witness(|packet| {
                    assert_eq!(packet.stamps.as_ptr(), allocation);
                    assert_eq!(packet.stamps, expected.stamps);
                    assert_eq!(packet.qualified, qualified);
                    panic!("original owner operation failed");
                });
            }))
            .is_err()
        );
        assert_eq!(facts.stamps.as_ptr(), allocation);
        assert_eq!(facts.witness().stamps, expected.stamps);
        assert_eq!(facts.is_qualified(), qualified);
        // Hash bucket indices must still refer to the original complete vector.
        facts.insert(stamp.clone());
        facts.insert(changed.clone());
        assert_eq!(facts.stamps.as_ptr(), allocation);
        assert_eq!(facts.witness().stamps, expected.stamps);
        let third = fact(path, b"C", path, FactRole::Configuration);
        facts.insert(third.clone());
        let completed = facts.finish(());
        assert_eq!(
            completed.stamps,
            vec![stamp.clone(), changed.clone(), third]
        );
        assert_eq!(completed.qualified, qualified);
        assert!(Arc::ptr_eq(completed.stamps[0].owner().unwrap(), &owner));
    }
}
