// Take a look at the license at the top of the repository in the LICENSE file.

use std::fmt;

glib::wrapper! {
    #[doc(alias = "GdkKeymapKey")]
    pub struct KeymapKey(BoxedInline<ffi::GdkKeymapKey>);
}

impl KeymapKey {
    pub fn keycode(&self) -> u32 {
        self.inner.keycode
    }
    pub fn group(&self) -> i32 {
        self.inner.group
    }
    pub fn level(&self) -> i32 {
        self.inner.level
    }
}

impl fmt::Debug for KeymapKey {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Geometry")
            .field("keycode", &self.keycode())
            .field("group", &self.group())
            .field("level", &self.level())
            .finish()
    }
}
