// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::container::ContainerImpl;

use crate::Stack;

pub trait StackImpl: ContainerImpl {}

unsafe impl<T: ContainerImpl> IsSubclassable<T> for Stack {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
