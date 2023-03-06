module wormhole::migrate {
    use wormhole::state::{Self, State};
    //use wormhole::version_control::{Self as control};

    const E_CANNOT_MIGRATE: u64 = 0;

    public entry fun migrate(
        wormhole_state: &mut State,
    ) {
        assert!(state::can_migrate(wormhole_state), E_CANNOT_MIGRATE);
        ////////////////////////////////////////////////////////////////////////
        //
        // If there are any methods that require the current build, we need to
        // explicity require them here.
        //
        // Calls to `require_current_version` are commented out for convenience.
        //
        ////////////////////////////////////////////////////////////////////////

        // state::require_current_version<control::NewEmitter>(wormhole_state);
        // state::require_current_version<control::ParseAndVerify>(wormhole_state);
        // state::require_current_version<control::PublishMessage>(wormhole_state);
        // state::require_current_version<control::SetFee>(wormhole_state);
        // state::require_current_version<control::TransferFee>(wormhole_state);
        // state::require_current_version<control::UpdateGuardianSet>(wormhole_state);

        ////////////////////////////////////////////////////////////////////////
        //
        // NOTE: Put any one-off migration logic here.
        //
        // Most upgrades likely won't need to do anything, in which case the
        // rest of this function's body may be empty. Make sure to delete it
        // after the migration has gone through successfully.
        //
        // WARNING: The migration does *not* proceed atomically with the
        // upgrade (as they are done in separate transactions).
        // If the nature of your migration absolutely requires the migration to
        // happen before certain other functionality is available, then guard
        // that functionality with the `assert!` from above.
        //
        ////////////////////////////////////////////////////////////////////////



        ////////////////////////////////////////////////////////////////////////
        // Done.
        state::disable_migration(wormhole_state);
    }
}
