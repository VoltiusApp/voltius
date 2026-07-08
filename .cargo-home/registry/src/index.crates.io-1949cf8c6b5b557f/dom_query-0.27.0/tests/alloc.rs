#[cfg(target_arch = "wasm32")]
#[global_allocator]
pub static ALLOC: &alloc_cat::AllocCat = &alloc_cat::ALLOCATOR;
