#[cfg(feature = "utoipa")]
#[test]
fn schema() {
    use json_patch::*;
    use utoipa::OpenApi;

    #[utoipa::path(
        get,
        path = "foo",
        request_body = Patch,
        responses(
            (status = 200, description = "Patch completed"),
            (status = 406, description = "Not accepted"),
        ),
    )]
    #[allow(unused)]
    fn get_foo(body: Patch) {}

    #[derive(OpenApi, Default)]
    #[openapi(
        paths(get_foo),
        components(schemas(
            AddOperation,
            CopyOperation,
            MoveOperation,
            PatchOperation,
            RemoveOperation,
            ReplaceOperation,
            TestOperation,
            Patch,
        ))
    )]
    struct ApiDoc;

    let mut doc = ApiDoc::openapi();

    doc.info.version = "0.0.0".to_string();
    let json = doc.to_pretty_json().unwrap();
    expectorate::assert_contents("tests/utoipa.json", &json);
}
