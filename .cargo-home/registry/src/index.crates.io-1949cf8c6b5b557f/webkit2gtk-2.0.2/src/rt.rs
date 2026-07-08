// Take a look at the license at the top of the repository in the LICENSE file.

macro_rules! assert_initialized_main_thread {
  () => {
    if !::gtk::is_initialized_main_thread() {
      if ::gtk::is_initialized() {
        panic!("GTK may only be used from the main thread.");
      } else {
        panic!("GTK has not been initialized. Call `gtk::init` first.");
      }
    }
  };
}

macro_rules! skip_assert_initialized {
  () => {};
}
