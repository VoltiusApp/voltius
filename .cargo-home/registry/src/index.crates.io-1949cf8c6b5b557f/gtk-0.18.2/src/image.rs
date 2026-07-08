// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Align;
use crate::Container;
use crate::IconSize;
use crate::Image;
use glib::object::{IsA, ObjectExt};
use glib::signal::{connect_raw, SignalHandlerId};
use glib::translate::*;
use glib::Cast;
use std::boxed::Box as Box_;
use std::mem::transmute;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Image>> Sealed for T {}
}

pub trait ImageExtManual: IsA<Image> + sealed::Sealed + 'static {
    #[doc(alias = "icon-size")]
    fn icon_size(&self) -> IconSize {
        unsafe { from_glib(self.as_ref().property::<i32>("icon-size")) }
    }

    #[doc(alias = "icon-size")]
    fn set_icon_size(&self, icon_size: IconSize) {
        self.as_ref()
            .set_property("icon-size", icon_size.into_glib());
    }

    #[doc(alias = "icon-size")]
    fn connect_icon_size_notify<F: Fn(&Self) + 'static>(&self, f: F) -> SignalHandlerId {
        unsafe extern "C" fn notify_icon_size_trampoline<P: IsA<Image>, F: Fn(&P) + 'static>(
            this: *mut ffi::GtkImage,
            _param_spec: glib::ffi::gpointer,
            f: glib::ffi::gpointer,
        ) {
            let f: &F = &*(f as *const F);
            f(Image::from_glib_borrow(this).unsafe_cast_ref())
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"notify::icon-size\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    notify_icon_size_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }
}

impl<O: IsA<Image>> ImageExtManual for O {}

impl Image {
    // rustdoc-stripper-ignore-next
    /// Creates a new builder-style object to construct a [`Image`].
    ///
    /// This method returns an instance of [`ImageBuilder`] which can be used to create a [`Image`].
    pub fn builder() -> ImageBuilder {
        ImageBuilder::new()
    }
}

// rustdoc-stripper-ignore-next
/// A builder for generating a [`Image`].
#[must_use = "The builder must be built to be used"]
pub struct ImageBuilder {
    builder: glib::object::ObjectBuilder<'static, Image>,
}

impl ImageBuilder {
    // rustdoc-stripper-ignore-next
    /// Create a new [`ImageBuilder`].
    pub fn new() -> Self {
        Self {
            builder: glib::object::Object::builder(),
        }
    }

    pub fn file(self, file: &str) -> Self {
        Self {
            builder: self.builder.property("file", file),
        }
    }

    pub fn gicon<P: IsA<gio::Icon>>(self, gicon: &P) -> Self {
        Self {
            builder: self.builder.property("gicon", gicon),
        }
    }

    pub fn icon_name(self, icon_name: &str) -> Self {
        Self {
            builder: self.builder.property("icon-name", icon_name),
        }
    }

    pub fn icon_size(self, icon_size: IconSize) -> Self {
        Self {
            builder: self.builder.property("icon-size", icon_size),
        }
    }

    pub fn pixbuf(self, pixbuf: &gdk_pixbuf::Pixbuf) -> Self {
        Self {
            builder: self.builder.property("pixbuf", pixbuf),
        }
    }

    pub fn pixbuf_animation<P: IsA<gdk_pixbuf::PixbufAnimation>>(
        self,
        pixbuf_animation: &P,
    ) -> Self {
        Self {
            builder: self.builder.property("pixbuf-animation", pixbuf_animation),
        }
    }

    pub fn pixel_size(self, pixel_size: i32) -> Self {
        Self {
            builder: self.builder.property("pixel-size", pixel_size),
        }
    }

    pub fn resource(self, resource: &str) -> Self {
        Self {
            builder: self.builder.property("resource", resource),
        }
    }

    pub fn surface(self, surface: &cairo::Surface) -> Self {
        Self {
            builder: self.builder.property("surface", surface),
        }
    }

    pub fn use_fallback(self, use_fallback: bool) -> Self {
        Self {
            builder: self.builder.property("use-fallback", use_fallback),
        }
    }

    pub fn app_paintable(self, app_paintable: bool) -> Self {
        Self {
            builder: self.builder.property("app-paintable", app_paintable),
        }
    }

    pub fn can_default(self, can_default: bool) -> Self {
        Self {
            builder: self.builder.property("can-default", can_default),
        }
    }

    pub fn can_focus(self, can_focus: bool) -> Self {
        Self {
            builder: self.builder.property("can-focus", can_focus),
        }
    }

    pub fn events(self, events: gdk::EventMask) -> Self {
        Self {
            builder: self.builder.property("events", events),
        }
    }

    pub fn expand(self, expand: bool) -> Self {
        Self {
            builder: self.builder.property("expand", expand),
        }
    }

    pub fn focus_on_click(self, focus_on_click: bool) -> Self {
        Self {
            builder: self.builder.property("focus-on-click", focus_on_click),
        }
    }

    pub fn halign(self, halign: Align) -> Self {
        Self {
            builder: self.builder.property("halign", halign),
        }
    }

    pub fn has_default(self, has_default: bool) -> Self {
        Self {
            builder: self.builder.property("has-default", has_default),
        }
    }

    pub fn has_focus(self, has_focus: bool) -> Self {
        Self {
            builder: self.builder.property("has-focus", has_focus),
        }
    }

    pub fn has_tooltip(self, has_tooltip: bool) -> Self {
        Self {
            builder: self.builder.property("has-tooltip", has_tooltip),
        }
    }

    pub fn height_request(self, height_request: i32) -> Self {
        Self {
            builder: self.builder.property("height-request", height_request),
        }
    }

    pub fn hexpand(self, hexpand: bool) -> Self {
        Self {
            builder: self.builder.property("hexpand", hexpand),
        }
    }

    pub fn hexpand_set(self, hexpand_set: bool) -> Self {
        Self {
            builder: self.builder.property("hexpand-set", hexpand_set),
        }
    }

    pub fn is_focus(self, is_focus: bool) -> Self {
        Self {
            builder: self.builder.property("is-focus", is_focus),
        }
    }

    pub fn margin(self, margin: i32) -> Self {
        Self {
            builder: self.builder.property("margin", margin),
        }
    }

    pub fn margin_bottom(self, margin_bottom: i32) -> Self {
        Self {
            builder: self.builder.property("margin-bottom", margin_bottom),
        }
    }

    pub fn margin_end(self, margin_end: i32) -> Self {
        Self {
            builder: self.builder.property("margin-end", margin_end),
        }
    }

    pub fn margin_start(self, margin_start: i32) -> Self {
        Self {
            builder: self.builder.property("margin-start", margin_start),
        }
    }

    pub fn margin_top(self, margin_top: i32) -> Self {
        Self {
            builder: self.builder.property("margin-top", margin_top),
        }
    }

    pub fn name(self, name: &str) -> Self {
        Self {
            builder: self.builder.property("name", name),
        }
    }

    pub fn no_show_all(self, no_show_all: bool) -> Self {
        Self {
            builder: self.builder.property("no-show-all", no_show_all),
        }
    }

    pub fn opacity(self, opacity: f64) -> Self {
        Self {
            builder: self.builder.property("opacity", opacity),
        }
    }

    pub fn parent<P: IsA<Container>>(self, parent: &P) -> Self {
        Self {
            builder: self.builder.property("parent", parent),
        }
    }

    pub fn receives_default(self, receives_default: bool) -> Self {
        Self {
            builder: self.builder.property("receives-default", receives_default),
        }
    }

    pub fn sensitive(self, sensitive: bool) -> Self {
        Self {
            builder: self.builder.property("sensitive", sensitive),
        }
    }

    pub fn tooltip_markup(self, tooltip_markup: &str) -> Self {
        Self {
            builder: self.builder.property("tooltip-markup", tooltip_markup),
        }
    }

    pub fn tooltip_text(self, tooltip_text: &str) -> Self {
        Self {
            builder: self.builder.property("tooltip-text", tooltip_text),
        }
    }

    pub fn valign(self, valign: Align) -> Self {
        Self {
            builder: self.builder.property("valign", valign),
        }
    }

    pub fn vexpand(self, vexpand: bool) -> Self {
        Self {
            builder: self.builder.property("vexpand", vexpand),
        }
    }

    pub fn vexpand_set(self, vexpand_set: bool) -> Self {
        Self {
            builder: self.builder.property("vexpandset", vexpand_set),
        }
    }

    pub fn visible(self, visible: bool) -> Self {
        Self {
            builder: self.builder.property("visible", visible),
        }
    }

    pub fn width_request(self, width_request: i32) -> Self {
        Self {
            builder: self.builder.property("width-request", width_request),
        }
    }

    // rustdoc-stripper-ignore-next
    /// Build the [`Image`].
    #[must_use = "Building the object from the builder is usually expensive and is not expected to have side effects"]
    pub fn build(self) -> Image {
        self.builder.build()
    }
}
