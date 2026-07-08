// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

use glib::subclass::prelude::*;

use glib::Cast;

use super::widget::WidgetImpl;
use crate::Container;
use crate::Widget;
use crate::WidgetPath;

pub trait ContainerImpl: ContainerImplExt + WidgetImpl {
    fn add(&self, widget: &Widget) {
        self.parent_add(widget)
    }

    fn remove(&self, widget: &Widget) {
        self.parent_remove(widget)
    }

    fn check_resize(&self) {
        self.parent_check_resize()
    }

    fn set_focus_child(&self, widget: Option<&Widget>) {
        self.parent_set_focus_child(widget)
    }

    fn child_type(&self) -> glib::Type {
        self.parent_child_type()
    }

    #[doc(alias = "get_path_for_child")]
    fn path_for_child(&self, widget: &Widget) -> WidgetPath {
        self.parent_path_for_child(widget)
    }

    fn forall(&self, include_internals: bool, callback: &Callback) {
        self.parent_forall(include_internals, callback);
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::ContainerImpl> Sealed for T {}
}

pub trait ContainerImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_add(&self, widget: &Widget) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).add {
                f(
                    self.obj().unsafe_cast_ref::<Container>().to_glib_none().0,
                    widget.to_glib_none().0,
                )
            }
        }
    }
    fn parent_remove(&self, widget: &Widget) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).remove {
                f(
                    self.obj().unsafe_cast_ref::<Container>().to_glib_none().0,
                    widget.to_glib_none().0,
                )
            }
        }
    }
    fn parent_check_resize(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).check_resize {
                f(self.obj().unsafe_cast_ref::<Container>().to_glib_none().0)
            }
        }
    }
    fn parent_set_focus_child(&self, widget: Option<&Widget>) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).set_focus_child {
                f(
                    self.obj().unsafe_cast_ref::<Container>().to_glib_none().0,
                    widget.to_glib_none().0,
                )
            }
        }
    }
    fn parent_child_type(&self) -> glib::Type {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).child_type {
                from_glib(f(self
                    .obj()
                    .unsafe_cast_ref::<Container>()
                    .to_glib_none()
                    .0))
            } else {
                glib::Type::UNIT
            }
        }
    }
    fn parent_path_for_child(&self, widget: &Widget) -> WidgetPath {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            let f = (*parent_class)
                .get_path_for_child
                .expect("No parent class impl for \"get_path_for_child\"");
            from_glib_none(f(
                self.obj().unsafe_cast_ref::<Container>().to_glib_none().0,
                widget.to_glib_none().0,
            ))
        }
    }
    fn parent_forall(&self, include_internals: bool, callback: &Callback) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkContainerClass;
            if let Some(f) = (*parent_class).forall {
                f(
                    self.obj().unsafe_cast_ref::<Container>().to_glib_none().0,
                    include_internals.into_glib(),
                    callback.callback,
                    callback.user_data,
                )
            }
        }
    }
}

impl<T: ContainerImpl> ContainerImplExt for T {}

unsafe impl<T: ContainerImpl> IsSubclassable<T> for Container {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.add = Some(container_add::<T>);
        klass.remove = Some(container_remove::<T>);
        klass.check_resize = Some(container_check_resize::<T>);
        klass.set_focus_child = Some(container_set_focus_child::<T>);
        klass.child_type = Some(container_child_type::<T>);
        klass.get_path_for_child = Some(container_get_path_for_child::<T>);
        klass.forall = Some(container_forall::<T>);
    }
}

unsafe extern "C" fn container_add<T: ContainerImpl>(
    ptr: *mut ffi::GtkContainer,
    wdgtptr: *mut ffi::GtkWidget,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let widget: Borrowed<Widget> = from_glib_borrow(wdgtptr);

    imp.add(&widget)
}

unsafe extern "C" fn container_remove<T: ContainerImpl>(
    ptr: *mut ffi::GtkContainer,
    wdgtptr: *mut ffi::GtkWidget,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let widget: Borrowed<Widget> = from_glib_borrow(wdgtptr);

    imp.remove(&widget)
}

unsafe extern "C" fn container_check_resize<T: ContainerImpl>(ptr: *mut ffi::GtkContainer) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.check_resize()
}

unsafe extern "C" fn container_set_focus_child<T: ContainerImpl>(
    ptr: *mut ffi::GtkContainer,
    wdgtptr: *mut ffi::GtkWidget,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let widget: Borrowed<Option<Widget>> = from_glib_borrow(wdgtptr);

    imp.set_focus_child(widget.as_ref().as_ref())
}

unsafe extern "C" fn container_child_type<T: ContainerImpl>(
    ptr: *mut ffi::GtkContainer,
) -> glib::ffi::GType {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.child_type().into_glib()
}

unsafe extern "C" fn container_get_path_for_child<T: ContainerImpl>(
    ptr: *mut ffi::GtkContainer,
    wdgtptr: *mut ffi::GtkWidget,
) -> *mut ffi::GtkWidgetPath {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let widget: Borrowed<Widget> = from_glib_borrow(wdgtptr);

    imp.path_for_child(&widget).to_glib_none().0
}

unsafe extern "C" fn container_forall<T: ObjectSubclass>(
    ptr: *mut ffi::GtkContainer,
    include_internals: glib::ffi::gboolean,
    callback: ffi::GtkCallback,
    user_data: glib::ffi::gpointer,
) where
    T: ContainerImpl,
{
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let callback = Callback {
        callback,
        user_data,
    };

    imp.forall(from_glib(include_internals), &callback)
}

#[derive(Debug)]
pub struct Callback {
    callback: ffi::GtkCallback,
    user_data: glib::ffi::gpointer,
}

impl Callback {
    pub fn call(&self, widget: &Widget) {
        unsafe {
            if let Some(callback) = self.callback {
                callback(widget.to_glib_none().0, self.user_data);
            }
        }
    }
}

pub unsafe trait ContainerClassSubclassExt: ClassStruct {
    #[doc(alias = "gtk_container_class_handle_border_width")]
    fn handle_border_width(&mut self) {
        unsafe {
            let widget_class = self as *mut _ as *mut ffi::GtkContainerClass;
            ffi::gtk_container_class_handle_border_width(widget_class);
        }
    }
}

unsafe impl<T: ClassStruct> ContainerClassSubclassExt for T where T::Type: ContainerImpl {}
