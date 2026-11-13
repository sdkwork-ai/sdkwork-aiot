use std::sync::atomic::Ordering;

fn main() {
    sdkwork_aiot_device_edge_runtime::assert_production_environment_safety();
    let handle = sdkwork_aiot_device_edge_runtime::spawn_device_edge_runtime_from_env()
        .expect("start AIoT device edge runtime");
    let shutdown_flag = handle.shutdown_flag();
    let _ = ctrlc::set_handler(move || {
        shutdown_flag.store(false, Ordering::Relaxed);
    });
    handle.wait();
}
