//! Each FTP data stream holds a login of its own, so streams on one pane overlap;
//! a login the server refuses waits for a running stream to hand its own back.
use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

async fn serve(socket: TcpStream, uploaded: Arc<Notify>) {
    let (input, mut output) = socket.into_split();
    let mut lines = BufReader::new(input).lines();
    let mut passive = None;
    output.write_all(b"220 ready\r\n").await.unwrap();
    while let Some(line) = lines.next_line().await.unwrap() {
        let command = line.split_ascii_whitespace().next().unwrap();
        let reply = match command {
            "USER" => "331 password".into(),
            "PASS" => "230 logged in".into(),
            "TYPE" => "200 binary".into(),
            "FEAT" | "MDTM" => "502 unsupported".into(),
            "SIZE" => "213 6".into(),
            "PASV" => {
                let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                let port = listener.local_addr().unwrap().port();
                passive = Some(listener);
                format!(
                    "227 Entering Passive Mode (127,0,0,1,{},{})",
                    port / 256,
                    port % 256
                )
            }
            "RETR" | "STOR" => {
                output.write_all(b"150 transferring\r\n").await.unwrap();
                let (mut data, _) = passive.take().unwrap().accept().await.unwrap();
                if command == "STOR" {
                    let mut bytes = Vec::new();
                    data.read_to_end(&mut bytes).await.unwrap();
                    assert_eq!(bytes, b"upload");
                    uploaded.notify_one();
                } else {
                    uploaded.notified().await;
                    data.write_all(b"download").await.unwrap();
                }
                "226 complete".into()
            }
            _ => panic!("unexpected FTP command: {command}"),
        };
        output
            .write_all(format!("{reply}\r\n").as_bytes())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn same_pane_upload_and_download_can_progress_together() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let uploaded = Arc::new(Notify::new());
        let (first, _) = listener.accept().await.unwrap();
        let first = tokio::spawn(serve(first, uploaded.clone()));
        let (second, _) = listener.accept().await.unwrap();
        serve(second, uploaded).await;
        first.await.unwrap();
    });

    timeout(Duration::from_secs(5), async {
        let ftp = connect("127.0.0.1", port, "test", Some("test"), false)
            .await
            .unwrap();
        let download = ftp.endpoint();
        let upload = ftp.endpoint();
        let mut reader = download.open_read("/input", 0).await.unwrap();
        // A later upload checks its destination in the pane before joining the queue.
        assert_eq!(
            FileBackend::stat(&ftp, "/output").await.unwrap(),
            Some(false)
        );
        let mut writer = upload.open_write("/output", 0, 6).await.unwrap();
        writer.write_all(b"upload").await.unwrap();
        writer.shutdown().await.unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, b"download");
    })
    .await
    .expect("overlapping FTP transfers must finish");
    server.await.unwrap();
}

#[tokio::test]
async fn sequential_files_reuse_one_login() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        drop(listener); // This server accepts exactly one login.
        serve(socket, Arc::new(Notify::new())).await;
    });
    let ftp = connect("127.0.0.1", port, "test", Some("test"), false)
        .await
        .unwrap();
    let mut writer = ftp.endpoint().open_write("/one", 0, 6).await.unwrap();
    writer.write_all(b"upload").await.unwrap();
    writer.shutdown().await.unwrap();
    let mut reader = ftp.endpoint().open_read("/two", 0).await.unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).await.unwrap();
    assert_eq!(bytes, b"download");
    drop(ftp);
    server.await.unwrap();
}

#[tokio::test]
async fn a_refused_extra_login_waits_for_a_stream_to_return_its_own() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let refused = Arc::new(Notify::new());
        let (first, _) = listener.accept().await.unwrap();
        let first = tokio::spawn(serve(first, refused.clone()));
        let (mut second, _) = listener.accept().await.unwrap();
        second
            .write_all(b"421 Too many connections from your IP\r\n")
            .await
            .unwrap();
        drop(second);
        refused.notify_one();
        first.await.unwrap();
    });

    timeout(Duration::from_secs(5), async {
        let ftp = connect("127.0.0.1", port, "test", Some("test"), false)
            .await
            .unwrap();
        let mut reader = ftp.endpoint().open_read("/input", 0).await.unwrap();
        let upload = ftp.endpoint();
        let uploaded = tokio::spawn(async move {
            let mut writer = upload.open_write("/output", 0, 6).await.unwrap();
            writer.write_all(b"upload").await.unwrap();
            writer.shutdown().await.unwrap();
        });
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, b"download");
        uploaded.await.unwrap();
    })
    .await
    .expect("the upload must run on the login the download returns");
    server.await.unwrap();
}

#[tokio::test]
async fn a_refused_login_fails_when_no_stream_holds_one() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (first, _) = listener.accept().await.unwrap();
        tokio::spawn(serve(first, Arc::new(Notify::new())));
        let (mut second, _) = listener.accept().await.unwrap();
        second
            .write_all(b"421 Too many connections\r\n")
            .await
            .unwrap();
    });
    let ftp = connect("127.0.0.1", port, "test", Some("test"), false)
        .await
        .unwrap();
    *ftp.conn.lock().await = None;
    let stat = timeout(Duration::from_secs(5), FileBackend::stat(&ftp, "/x"))
        .await
        .expect("nothing holds a login to wait for");
    assert!(stat.is_err());
    server.await.unwrap();
}
