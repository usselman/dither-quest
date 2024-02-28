let img;
let ditheredImg; // Off-screen graphics buffer for dithering
let bwSlider, resSlider;
let canvas;

function setup() {
    canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('text-align', 'justify-between', 'center');
    controlsDiv.position(canvas.x, windowHeight - 220);

    bwSlider = createSlider(0, 255, 128);
    bwSlider.parent(controlsDiv);
    bwSlider.input(ellipseDitherImage); // Redraw dithered image when slider changes
    //bwSlider.label('Threshold');

    resSlider = createSlider(1, 150, 12, 1);
    resSlider.parent(controlsDiv);
    resSlider.input(ellipseDitherImage); // Redraw dithered image when slider changes
    //resSlider.label('Resolution');

    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);

    noLoop();
}

function draw() {
    // Now only redraws when explicitly called
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            // Initialize off-screen graphics buffer with original image dimensions
            ditheredImg = createGraphics(img.width, img.height);
            ellipseDitherImage(); // Apply dithering effect
        });
    }
}

function ellipseDitherImage() {
    if (!img) return; // Ensure the image is loaded

    ditheredImg.background(255); // Clear the buffer with a white background (if desired)
    let resolution = resSlider.value();
    img.loadPixels();

    for (let y = 0; y < img.height; y += resolution) {
        for (let x = 0; x < img.width; x += resolution) {
            let gray = 0;
            let count = 0;

            // Calculate the average grayscale value of the block
            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    gray += (img.pixels[nindex] + img.pixels[nindex + 1] + img.pixels[nindex + 2]) / 3;
                    count++;
                }
            }
            gray /= count;

            // Determine the size of the ellipse based on gray value
            let size = map(gray, 0, 255, resolution, 0);

            // ditheredImg.fill(gray);
            // ditheredImg.noStroke();

            ditheredImg.stroke(0);
            ditheredImg.strokeWeight(1 * gray / 12.5);
            ditheredImg.noFill();

            ditheredImg.ellipse(x + resolution / 2, y + resolution / 2, size, size);

            // ditheredImg.stroke(gray);
            // ditheredImg.strokeWeight(0.1);
            // ditheredImg.noFill();

            // ditheredImg.line(x + resolution * 2, size * 50, size * 1.25, size * 1.25);

            ditheredImg.translate(ditheredImg.mouseX, ditheredImg.mouseY);
        }
    }

    // After applying the dithering effect, display the scaled version on the main canvas
    image(ditheredImg, 0, 0, width, height);
}


function downloadImage() {
    // Save the off-screen buffer, preserving the original image dimensions and dithering effect
    save(ditheredImg, 'dithered_image.png');
}