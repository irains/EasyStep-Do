use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use crate::sync::config::{AuthMethod, WebdavConfig};

pub struct WebdavClient {
  http: reqwest::Client,
  config: WebdavConfig,
}

impl WebdavClient {
  pub fn new(config: &WebdavConfig) -> Result<Self, String> {
    let builder = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(config.timeout_secs))
      .connect_timeout(std::time::Duration::from_secs(10));

    let http = builder
      .build()
      .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    Ok(Self {
      http,
      config: config.clone(),
    })
  }

  pub async fn detect_auth_method(&self) -> Result<AuthMethod, String> {
    let url = normalize_url(&self.config.server_url);
    let body = r#"<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>"#;

    let response = self
      .http
      .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
      .header("Depth", "0")
      .header("Content-Type", "application/xml; charset=utf-8")
      .body(body)
      .send()
      .await
      .map_err(|e| format!("连接 WebDAV 服务器失败: {e}"))?;

    if response.status().is_success() || response.status().as_u16() == 207 {
      return Ok(AuthMethod::Basic);
    }

    if response.status().as_u16() == 401 {
      let www_auth = response
        .headers()
        .get("www-authenticate")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

      if www_auth.contains("digest") {
        return Ok(AuthMethod::Digest);
      }
      if www_auth.contains("basic") {
        return Ok(AuthMethod::Basic);
      }
      return Err("无法识别认证方式，请手动选择".to_string());
    }

    Err(format!("意外响应: HTTP {}", response.status()))
  }

  pub async fn ensure_remote_dir(&self) -> Result<(), String> {
    let url = normalize_url(&self.config.server_url);
    let remote_dir = self.config.remote_dir.trim_end_matches('/');
    let full_url = format!("{}{}", url, remote_dir.trim_start_matches('/'));

    let result = self.mkcol(&full_url).await;
    match result {
      Ok(()) => Ok(()),
      Err(e) => {
        if e.contains("405") || e.contains("409") || e.contains("already exists") {
          Ok(())
        } else {
          Err(e)
        }
      }
    }
  }

  pub async fn get_file(&self, path: &str) -> Result<(Vec<u8>, Option<String>), String> {
    let url = build_url(&self.config.server_url, path);
    let response = self.authed_request(reqwest::Method::GET, &url).send().await.map_err(|e| format!("下载文件失败: {e}"))?;

    if response.status().as_u16() == 404 {
      return Err("远程文件不存在".to_string());
    }

    if !response.status().is_success() {
      return Err(format!("下载文件失败: HTTP {}", response.status()));
    }

    let etag = response
      .headers()
      .get("etag")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_string());

    let bytes = response
      .bytes()
      .await
      .map_err(|e| format!("读取文件内容失败: {e}"))?;

    Ok((bytes.to_vec(), etag))
  }

  pub async fn put_file(&self, path: &str, data: &[u8], etag: Option<&str>) -> Result<Option<String>, String> {
    let url = build_url(&self.config.server_url, path);
    let mut request = self.authed_request(reqwest::Method::PUT, &url).body(data.to_vec());

    if let Some(etag_val) = etag {
      request = request.header("If-Match", etag_val);
    }

    let response = request.send().await.map_err(|e| format!("上传文件失败: {e}"))?;

    if response.status().as_u16() == 412 {
      return Err("同步冲突: 远程文件已被其他客户端更新，请重试".to_string());
    }

    if !response.status().is_success() && response.status().as_u16() != 201 && response.status().as_u16() != 204 {
      return Err(format!("上传文件失败: HTTP {}", response.status()));
    }

    let new_etag = response
      .headers()
      .get("etag")
      .and_then(|v| v.to_str().ok())
      .map(|s| s.to_string());

    Ok(new_etag)
  }

  async fn mkcol(&self, url: &str) -> Result<(), String> {
    let response = self
      .authed_request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), url)
      .send()
      .await
      .map_err(|e| format!("创建远程目录失败: {e}"))?;

    if response.status().is_success() || response.status().as_u16() == 405 || response.status().as_u16() == 409 {
      return Ok(());
    }

    Err(format!("创建远程目录失败: HTTP {}", response.status()))
  }

  fn authed_request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
    let mut builder = self.http.request(method, url);

    let auth = match self.config.auth_method {
      AuthMethod::Digest => {
        builder = builder.header("Authorization", format!("Digest username=\"{}\"", self.config.username));
        None
      }
      AuthMethod::Basic | AuthMethod::Auto => {
        let encoded = BASE64.encode(format!("{}:{}", self.config.username, self.config.password));
        Some(format!("Basic {}", encoded))
      }
    };

    if let Some(auth_header) = auth {
      builder = builder.header("Authorization", &auth_header);
    }

    builder
  }
}

fn normalize_url(url: &str) -> String {
  let url = url.trim_end_matches('/');
  format!("{}/", url)
}

fn build_url(base: &str, path: &str) -> String {
  let base = base.trim_end_matches('/');
  let path = path.trim_start_matches('/');
  format!("{}/{}", base, path)
}