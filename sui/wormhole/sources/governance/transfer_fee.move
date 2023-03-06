module wormhole::transfer_fee {
    use sui::transfer::{Self};
    use sui::tx_context::{TxContext};

    use wormhole::bytes::{Self};
    use wormhole::version_control::{TransferFee as TransferFeeControl};
    use wormhole::cursor::{Self};
    use wormhole::external_address::{Self};
    use wormhole::governance_message::{Self, GovernanceMessage};
    use wormhole::state::{Self, State};

    const E_WITHDRAW_AMOUNT_OVERFLOW: u64 = 0;

    /// Specific governance payload ID (action) for setting Wormhole fee.
    const ACTION_TRANSFER_FEE: u8 = 4;

    struct TransferFee {
        amount: u64,
        recipient: address
    }

    public fun transfer_fee(
        wormhole_state: &mut State,
        vaa_buf: vector<u8>,
        ctx: &mut TxContext
    ): u64 {
        state::check_minimum_requirement<TransferFeeControl>(wormhole_state);

        let msg =
            governance_message::parse_and_verify_vaa(
                wormhole_state,
                vaa_buf,
                ctx
            );

        // Do not allow this VAA to be replayed.
        state::consume_vaa_hash(
            wormhole_state,
            governance_message::vaa_hash(&msg)
        );

        // Proceed with setting the new message fee.
        handle_transfer_fee(wormhole_state, msg, ctx)
    }

    fun handle_transfer_fee(
        wormhole_state: &mut State,
        msg: GovernanceMessage,
        ctx: &mut TxContext
    ): u64 {
        // Verify that this governance message is to update the Wormhole fee.
        let governance_payload =
            governance_message::take_local_action(
                msg,
                state::governance_module(),
                ACTION_TRANSFER_FEE
            );

        // Deserialize the payload as amount to withdraw and to whom SUI should
        // be sent.
        let TransferFee { amount, recipient } = deserialize(governance_payload);

        transfer::transfer(
            state::withdraw_fee(wormhole_state, amount, ctx),
            recipient
        );

        amount
    }

    fun deserialize(payload: vector<u8>): TransferFee {
        let cur = cursor::new(payload);

        // This amount cannot be greater than max u64.
        let amount = bytes::take_u256_be(&mut cur);
        assert!(amount < (1u256 << 64), E_WITHDRAW_AMOUNT_OVERFLOW);

        // Recipient must be non-zero address.
        let recipient = external_address::take_nonzero(&mut cur);

        cursor::destroy_empty(cur);

        TransferFee {
            amount: (amount as u64),
            recipient: external_address::to_address(recipient)
        }
    }

    #[test_only]
    public fun action(): u8 {
        ACTION_TRANSFER_FEE
    }
}

#[test_only]
module wormhole::transfer_fee_test {
    use sui::coin::{Self, Coin};
    use sui::sui::{SUI};
    use sui::test_scenario::{Self};

    use wormhole::bytes::{Self};
    use wormhole::bytes32::{Self};
    use wormhole::cursor::{Self};
    use wormhole::external_address::{Self};
    use wormhole::fee_collector::{Self};
    use wormhole::governance_message::{Self};
    use wormhole::state::{Self, State};
    use wormhole::transfer_fee::{Self};
    use wormhole::wormhole_scenario::{set_up_wormhole, person, two_people};

    const VAA_TRANSFER_FEE_1: vector<u8> =
        x"01000000000100a96aee105d7683266d98c9b274eddb20391378adddcefbc7a5266b4be78bc6eb582797741b65617d796c6c613ae7a4dad52a8b4aa4659842dcc4c9b3891549820100bc614e000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000010100000000000000000000000000000000000000000000000000000000436f726504001500000000000000000000000000000000000000000000000000000000000004b0000000000000000000000000000000000000000000000000000000000000b0b2";
    const VAA_BOGUS_TARGET_CHAIN: vector<u8> =
        x"010000000001006dd286e0d7a410ce413d119aced82ecb78fadd59563ceb6537ac6ad91ba64e4609c4ca9362761760618a4cdf38249319ee6d92d78e0ab5bce896da2234aafc0d0000bc614e000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000010100000000000000000000000000000000000000000000000000000000436f726504000200000000000000000000000000000000000000000000000000000000000004b0000000000000000000000000000000000000000000000000000000000000b0b2";
    const VAA_BOGUS_ACTION: vector<u8> =
        x"0100000000010001589ed96691ad0aa479ad14315cc337a3c45adfc2a8736f901649a19400fb9561edfa42c9583cfebab8f94df86863afd615a9f451c1d54f97cc6a12aa4446760000bc614e000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000010100000000000000000000000000000000000000000000000000000000436f726501001500000000000000000000000000000000000000000000000000000000000004b0000000000000000000000000000000000000000000000000000000000000b0b2";
    const VAA_TRANSFER_FEE_OVERFLOW: vector<u8> =
        x"01000000000100529b407a673f8917ccb9bb6f8d46d0f729c1ff845b0068ef5e0a3de464670b2e379a8994b15362785e52d73e01c880dbcdf432ef3702782d17d352fb07ed86830100bc614e000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000010100000000000000000000000000000000000000000000000000000000436f72650400150000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000b0b2";
    const VAA_TRANSFER_FEE_ZERO_ADDRESS: vector<u8> =
        x"0100000000010032b2ab65a690ae4af8c85903d7b22239fc272183eefdd5a4fa784664f82aa64b381380cc03859156e88623949ce4da4435199aaac1cb09e52a09d6915725a5e70100bc614e000000000001000000000000000000000000000000000000000000000000000000000000000400000000000000010100000000000000000000000000000000000000000000000000000000436f726504001500000000000000000000000000000000000000000000000000000000000004b00000000000000000000000000000000000000000000000000000000000000000";

    #[test]
    public fun test_transfer_fee() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let (caller, recipient) = two_people();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 350;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Double-check current fee (from setup).
        assert!(state::message_fee(&worm_state) == wormhole_fee, 0);

        // Deposit fee several times.
        let (i, n) = (0, 8);
        while (i < n) {
            state::deposit_fee(
                &mut worm_state,
                coin::mint_for_testing<SUI>(
                    wormhole_fee,
                    test_scenario::ctx(scenario)
                )
            );
            i = i + 1;
        };

        // Double-check balance.
        let total_deposited = n * wormhole_fee;
        assert!(state::fees_collected(&worm_state) == total_deposited, 0);

        let withdrawn = transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_1,
            test_scenario::ctx(scenario)
        );
        assert!(withdrawn == 1200, 0);

        // Ignore effects.
        test_scenario::next_tx(scenario, caller);

        // Verify that the recipient received the withdrawal.
        let withdrawn_coin =
            test_scenario::take_from_address<Coin<SUI>>(scenario, recipient);
        assert!(coin::value(&withdrawn_coin) == withdrawn, 0);

        // And there is still a balance on Wormhole's fee collector.
        let remaining = total_deposited - withdrawn;
        assert!(state::fees_collected(&worm_state) == remaining, 0);

        // Clean up.
        test_scenario::return_to_address(recipient, withdrawn_coin);
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(abort_code = state::E_VAA_ALREADY_CONSUMED)]
    public fun test_cannot_transfer_fee_with_same_vaa() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 350;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Double-check current fee (from setup).
        assert!(state::message_fee(&worm_state) == wormhole_fee, 0);

        // Deposit fee several times.
        let (i, n) = (0, 8);
        while (i < n) {
            state::deposit_fee(
                &mut worm_state,
                coin::mint_for_testing<SUI>(
                    wormhole_fee,
                    test_scenario::ctx(scenario)
                )
            );
            i = i + 1;
        };

        // Transfer once.
        transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_1,
            test_scenario::ctx(scenario)
        );

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_1,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(
        abort_code = governance_message::E_GOVERNANCE_TARGET_CHAIN_NOT_SUI
    )]
    public fun test_cannot_transfer_fee_invalid_target_chain() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 0;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Setting a new fee only applies to this chain since the denomination
        // is SUI.
        let msg =
            governance_message::parse_and_verify_vaa(
                &mut worm_state,
                VAA_BOGUS_TARGET_CHAIN,
                test_scenario::ctx(scenario)
            );
        assert!(!governance_message::is_local_action(&msg), 0);
        governance_message::destroy(msg);

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_BOGUS_TARGET_CHAIN,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(
        abort_code = governance_message::E_INVALID_GOVERNANCE_ACTION
    )]
    public fun test_cannot_transfer_fee_invalid_action() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 0;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Setting a new fee only applies to this chain since the denomination
        // is SUI.
        let msg =
            governance_message::parse_and_verify_vaa(
                &mut worm_state,
                VAA_BOGUS_ACTION,
                test_scenario::ctx(scenario)
            );
        assert!(governance_message::action(&msg) != transfer_fee::action(), 0);
        governance_message::destroy(msg);

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_BOGUS_ACTION,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(abort_code = fee_collector::E_WITHDRAW_EXCEEDS_BALANCE)]
    public fun test_cannot_transfer_fee_insufficient_balance() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 350;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Show balance is zero.
        assert!(state::fees_collected(&worm_state) == 0, 0);

        // Show that the encoded fee is greater than zero.
        let msg =
            governance_message::parse_and_verify_vaa(
                &mut worm_state,
                VAA_TRANSFER_FEE_1,
                test_scenario::ctx(scenario)
            );
        let payload = governance_message::take_payload(msg);
        let cur = cursor::new(payload);

        let amount = bytes::take_u256_be(&mut cur);
        assert!(amount > 0, 0);
        cursor::rest(cur);

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_1,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(abort_code = external_address::E_ZERO_ADDRESS)]
    public fun test_cannot_transfer_fee_recipient_zero_address() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 350;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Show balance is zero.
        assert!(state::fees_collected(&worm_state) == 0, 0);

        // Show that the encoded fee is greater than zero.
        let msg =
            governance_message::parse_and_verify_vaa(
                &mut worm_state,
                VAA_TRANSFER_FEE_ZERO_ADDRESS,
                test_scenario::ctx(scenario)
            );
        let payload = governance_message::take_payload(msg);
        let cur = cursor::new(payload);

        bytes::take_u256_be(&mut cur);

        // Confirm recipient is zero address.
        let addr = bytes32::take(&mut cur);
        assert!(!bytes32::is_nonzero(&addr), 0);
        cursor::destroy_empty(cur);

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_ZERO_ADDRESS,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }

    #[test]
    #[expected_failure(abort_code = transfer_fee::E_WITHDRAW_AMOUNT_OVERFLOW)]
    public fun test_cannot_transfer_fee_withdraw_amount_overflow() {
        // Testing this method.
        use wormhole::transfer_fee::{transfer_fee};

        // Set up.
        let caller = person();
        let my_scenario = test_scenario::begin(caller);
        let scenario = &mut my_scenario;

        let wormhole_fee = 350;
        set_up_wormhole(scenario, wormhole_fee);

        // Prepare test to execute `update_guardian_set`.
        test_scenario::next_tx(scenario, caller);

        let worm_state = test_scenario::take_shared<State>(scenario);

        // Show balance is zero.
        assert!(state::fees_collected(&worm_state) == 0, 0);

        // Show that the encoded fee is greater than zero.
        let msg =
            governance_message::parse_and_verify_vaa(
                &mut worm_state,
                VAA_TRANSFER_FEE_OVERFLOW,
                test_scenario::ctx(scenario)
            );
        let payload = governance_message::take_payload(msg);
        let cur = cursor::new(payload);

        let amount = bytes::take_u256_be(&mut cur);
        assert!(amount > 0xffffffffffffffff, 0);
        cursor::rest(cur);

        // You shall not pass!
        transfer_fee(
            &mut worm_state,
            VAA_TRANSFER_FEE_OVERFLOW,
            test_scenario::ctx(scenario)
        );

        // Clean up even though we should have failed by this point.
        test_scenario::return_shared(worm_state);

        // Done.
        test_scenario::end(my_scenario);
    }
}
