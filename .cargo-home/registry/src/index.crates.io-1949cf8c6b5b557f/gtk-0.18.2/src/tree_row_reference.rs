// Take a look at the license at the top of the repository in the LICENSE file.

use crate::TreeIter;
use crate::TreePath;
use crate::TreeRowReference;
use glib::object::IsA;
use glib::translate::*;
use libc::c_int;

impl TreeRowReference {
    // rustdoc-stripper-ignore-next
    /// This is unsafe because new_order bounds can't be checked.
    #[allow(clippy::missing_safety_doc)]
    #[doc(alias = "gtk_tree_row_reference_reordered")]
    pub unsafe fn reordered<T: IsA<glib::Object>>(
        proxy: &T,
        path: &TreePath,
        iter: Option<&TreeIter>,
        new_order: &[u32],
    ) {
        assert_initialized_main_thread!();
        assert!(
            iter.is_some() || path.depth() == 0,
            "If 'iter' is None, 'path' must point to the root."
        );
        ffi::gtk_tree_row_reference_reordered(
            proxy.as_ref().to_glib_none().0,
            mut_override(path.to_glib_none().0),
            mut_override(iter.to_glib_none().0),
            mut_override(new_order.as_ptr() as *const c_int),
        );
    }
}
