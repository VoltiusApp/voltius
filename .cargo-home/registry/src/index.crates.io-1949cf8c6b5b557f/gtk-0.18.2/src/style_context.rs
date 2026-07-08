// Take a look at the license at the top of the repository in the LICENSE file.

use crate::prelude::*;
use crate::StateFlags;
use crate::StyleContext;
use pango::FontDescription;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::StyleContext>> Sealed for T {}
}

pub trait StyleContextExtManual: IsA<StyleContext> + sealed::Sealed + 'static {
    #[doc(alias = "get_font")]
    fn font(&self, state: StateFlags) -> FontDescription {
        self.style_property_for_state("font", state)
            .get()
            .expect("font property is not pango::FontDescription")
    }
}

impl<O: IsA<StyleContext>> StyleContextExtManual for O {}
