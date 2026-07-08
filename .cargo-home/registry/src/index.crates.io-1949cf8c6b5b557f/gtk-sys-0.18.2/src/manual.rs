// Take a look at the license at the top of the repository in the LICENSE file.

pub mod xlib {
    pub type Window = i32;
}

//=========================================================================
// GtkContainerClass
//=========================================================================

extern "C" {
    pub fn gtk_container_class_find_child_property(
        cclass: *const gobject::GObjectClass,
        property_name: *const libc::c_char,
    ) -> *mut gobject::GParamSpec;
}
