module programmable::state {
    use sui::object::{Self, UID};
    use sui::transfer::{Self};
    use sui::tx_context::{TxContext};

    struct Village has key {
        id: UID,
        persons: u64
    }

    struct A has drop {
        A: u64,
    }

    struct B has drop {
        B: u64
    }

    fun init(ctx: &mut TxContext) {
        let village = Village{id: object::new(ctx), persons: 6};
        transfer::share_object(village);
    }

    public fun produce_A(): A{
        return A{A: 6}
    }

    public fun consume_A_produce_B(_A: A): B {
        return B{B:9}
    }
}