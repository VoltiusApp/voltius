use bytemuck::{Pod, Zeroable};

use crate::{ArrayLength, GenericArray};

unsafe impl<T: Pod, N: ArrayLength> Pod for GenericArray<T, N> where GenericArray<T, N>: Copy {}

unsafe impl<T: Zeroable, N: ArrayLength> Zeroable for GenericArray<T, N> {}
