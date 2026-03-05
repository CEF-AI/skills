
async function handle(event: any, ctx: any) {
    const { image } = event.payload;

    const response = await ctx.fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: {
                "bucket": 1338,
                "name": "yolo11x_1280",
                "version": "v1.0.0"
            },
            input: {
                image: image
            }
        })
    }).then(res => res.json());
    ctx.log('Inference response', JSON.stringify(response));

    const detections = response.output.detections;

    return {
        totalDetections: detections.length,
        detections: detections,
        processingTime: response.metrics.inference_time
    };
}
