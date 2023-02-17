module token_bridge::native_asset {
    use sui::coin::{Self, Coin};
    use sui::tx_context::{TxContext};
    use wormhole::external_address::{ExternalAddress};
    use wormhole::state::{chain_id};

    use token_bridge::token_info::{Self, TokenInfo};

    // Needs 'deposit` and `withdraw`
    friend token_bridge::registered_tokens;
    #[test_only]
    friend token_bridge::native_asset_test;

    struct NativeAsset<phantom C> has store {
        custody: Coin<C>,
        token_address: ExternalAddress,
        decimals: u8
    }

    public fun new<C>(
        token_address: ExternalAddress,
        decimals: u8,
        ctx: &mut TxContext
    ): NativeAsset<C> {
        NativeAsset {
            custody: coin::zero(ctx),
            token_address,
            decimals
        }
    }

    #[test_only]
    public fun destroy<C>(
        self: NativeAsset<C>
    ){
        assert!(coin::value<C>(&self.custody)==0, 0);
        let NativeAsset<C>{
            custody: custody,
            token_address: _,
            decimals: _
        } = self;
        coin::destroy_zero<C>(custody);
    }

    public fun token_address<C>(
        self: &NativeAsset<C>
    ): ExternalAddress {
        self.token_address
    }

    public fun decimals<C>(self: &NativeAsset<C>): u8 {
        self.decimals
    }

    public fun balance<C>(self: &NativeAsset<C>): u64 {
        coin::value(&self.custody)
    }

    public fun to_token_info<C>(self: &NativeAsset<C>): TokenInfo<C> {
        token_info::new(
            false, // is_wrapped
            chain_id(),
            self.token_address
        )
    }

    public(friend) fun deposit<C>(
        self: &mut NativeAsset<C>,
        depositable: Coin<C>
    ) {
        coin::join(&mut self.custody, depositable)
    }

    public(friend) fun withdraw<C>(
        self: &mut NativeAsset<C>,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<C> {
        coin::split(&mut self.custody, amount, ctx)
    }
}

#[test_only]
module token_bridge::native_asset_test{
    use sui::test_scenario::{Self, Scenario, ctx, take_shared,
        return_shared, next_tx};
    use sui::coin::{Self, TreasuryCap};
    use sui::transfer::{Self};

    use wormhole::external_address::{Self};
    use wormhole::state::{chain_id};

    use token_bridge::token_info::{Self};
    use token_bridge::native_asset::{Self, new, token_address, decimals};
    use token_bridge::native_coin_witness::{Self, NATIVE_COIN_WITNESS};

    fun scenario(): Scenario { test_scenario::begin(@0x123233) }
    fun people(): (address, address, address) { (@0x124323, @0xE05, @0xFACE) }

    // in this test, we exercise all the functionalities of a native asset
    // object, including new, deposit, withdraw, to_token_info, as well as
    // getting fields token_address, decimals, balan.ce
    #[test]
    fun test_native_asset(){
        let test = scenario();
        let (admin, _, _) = people();
        let addr = external_address::from_bytes(x"00112233");
        let native_asset = new<NATIVE_COIN_WITNESS>(
            addr,
            3,
            ctx(&mut test)
        );

        // assert token address and decimals are correct
        assert!(token_address(&native_asset)==addr, 0);
        assert!(decimals(&native_asset)==3, 0);

        next_tx(&mut test, admin);{
            native_coin_witness::test_init(ctx(&mut test));
        };
        next_tx(&mut test, admin);{
             let tcap = take_shared<TreasuryCap<NATIVE_COIN_WITNESS>>(&test);
            // assert initial balance is zero
            let bal0 = native_asset::balance<NATIVE_COIN_WITNESS>(&native_asset);
            assert!(bal0==0, 0);

            // deposit some coins into the NativeAsset coin custody
            let coins = coin::mint<NATIVE_COIN_WITNESS>(&mut tcap, 1000, ctx(&mut test));
            native_asset::deposit<NATIVE_COIN_WITNESS>(&mut native_asset, coins);

            // assert new balance is correct
            let bal1 = native_asset::balance<NATIVE_COIN_WITNESS>(&native_asset);
            assert!(bal1==1000, 0);

            // convert to token info and assert convrsion is correct
            let token_info = native_asset::to_token_info<NATIVE_COIN_WITNESS>(
                &native_asset
            );

            assert!(token_info::chain(&token_info)==chain_id(), 0);
            assert!(token_info::addr(&token_info)==addr, 0);
            assert!(token_info::is_wrapped(&token_info)==false, 0);

            // withdraw half of coins from custody
            coins = native_asset::withdraw<NATIVE_COIN_WITNESS>(
                &mut native_asset,
                500,
                ctx(&mut test)
            );
            transfer::transfer(coins, admin);

            // check that updated balance is correct
            let bal2 = native_asset::balance<NATIVE_COIN_WITNESS>(&native_asset);
            assert!(bal2==500, 0);

            // withdraw second half of coins from custody
            coins = native_asset::withdraw<NATIVE_COIN_WITNESS>(
                &mut native_asset,
                500,
                ctx(&mut test)
            );
            transfer::transfer(coins, admin);

            native_asset::destroy<NATIVE_COIN_WITNESS>(native_asset);
            return_shared(tcap);
        };
        test_scenario::end(test);
    }
}
