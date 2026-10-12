//! Independent test-only provider. Never part of TinySynth.
#[starknet::interface]
pub trait IFixtureProvider<T> {
    fn library_segment(self: @T) -> ByteArray;
}
#[starknet::contract]
pub mod FixtureProvider {
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl Provider of super::IFixtureProvider<ContractState> {
        fn library_segment(self: @ContractState) -> ByteArray {
            "UEhOamNtbHdkQ0IwZVhCbFBTSjBaWGgwTDJwaGRtRnpZM0pwY0hRclozcHBjQ0lnYVdROUltTnZiWEJ2YzJsMGFXOXVMV1pwZUhSMWNtVWlJSE55WXowaVpHRjBZVHBoY0hCc2FXTmhkR2x2Ymk5bmVtbHdPMkpoYzJVMk5DeElOSE5KUVVGQlFVRkJRVU5CZVhaUWVrVjJTa3c1WkhwNmN6aDBlVU12VDB4TmJrMTZNMUJNY2tObmNFeFZjRlp6UmxoM1ZEaHdTMVJUTjFKVGVYUkxWR0V4U3pGaGFrOVRWWGhMZW1KR1UwdEZkazFMVVZoTE1tbHJiM0JWUmxWWGFXdHdZVVZPUldGNlYzUjFVVU5xU1UxTVIxVlJRVUZCUVQwOUlqNDhMM05qY21sd2RENGdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0Fn"
        }
    }
}
