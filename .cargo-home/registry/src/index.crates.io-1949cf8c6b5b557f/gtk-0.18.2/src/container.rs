// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{Container, Widget};
use glib::translate::*;
use glib::{value::FromValue, IsA, ToValue};

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Container>> Sealed for T {}
}

pub trait ContainerExtManual: IsA<Container> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_container_child_get_property")]
    fn child_property_value(&self, child: &impl IsA<Widget>, property_name: &str) -> glib::Value {
        unsafe {
            let container_class = glib::Class::<Container>::from_type(Self::static_type()).unwrap();
            let pspec: Option<glib::ParamSpec> =
                from_glib_none(ffi::gtk_container_class_find_child_property(
                    container_class.as_ref() as *const _ as *const glib::gobject_ffi::GObjectClass,
                    property_name.to_glib_none().0,
                ));
            let pspec = pspec.unwrap_or_else(|| {
                panic!("The Container property '{property_name}' doesn't exists")
            });

            if !pspec.flags().contains(glib::ParamFlags::READABLE)
                || !pspec.flags().contains(glib::ParamFlags::READWRITE)
            {
                panic!("The Container property '{property_name}' is not readable");
            }

            let mut value = glib::Value::from_type(pspec.value_type());
            ffi::gtk_container_child_get_property(
                self.as_ref().to_glib_none().0,
                child.as_ref().to_glib_none().0,
                property_name.to_glib_none().0,
                value.to_glib_none_mut().0,
            );
            value
        }
    }

    #[doc(alias = "gtk_container_child_get_property")]
    fn child_property<V: for<'b> FromValue<'b> + 'static>(
        &self,
        child: &impl IsA<Widget>,
        property_name: &str,
    ) -> V {
        let value = self.child_property_value(child, property_name);
        value
            .get_owned::<V>()
            .expect("Failed to get value of container")
    }

    #[doc(alias = "gtk_container_child_set_property")]
    fn child_set_property(
        &self,
        child: &impl IsA<Widget>,
        property_name: &str,
        value: &dyn ToValue,
    ) {
        unsafe {
            let container_class = glib::Class::<Container>::from_type(Self::static_type()).unwrap();
            let pspec: Option<glib::ParamSpec> =
                from_glib_none(ffi::gtk_container_class_find_child_property(
                    container_class.as_ref() as *const _ as *const glib::gobject_ffi::GObjectClass,
                    property_name.to_glib_none().0,
                ));
            let pspec = pspec.unwrap_or_else(|| {
                panic!("The Container property '{property_name}' doesn't exists")
            });

            if !pspec.flags().contains(glib::ParamFlags::WRITABLE)
                || !pspec.flags().contains(glib::ParamFlags::READWRITE)
            {
                panic!("The Container property '{property_name}' is not writeable");
            }

            assert!(
                pspec.value_type().is_a(value.value_type()),
                "The Container property '{}' is value is of wrong type. Expected '{}' but got '{}'",
                property_name,
                pspec.value_type(),
                value.value_type()
            );

            ffi::gtk_container_child_set_property(
                self.as_ref().to_glib_none().0,
                child.as_ref().to_glib_none().0,
                property_name.to_glib_none().0,
                value.to_value().to_glib_none().0,
            );
        }
    }
}

impl<O: IsA<Container>> ContainerExtManual for O {}
